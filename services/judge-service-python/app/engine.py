from __future__ import annotations
import os
import re
import select
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from abc import ABC, abstractmethod
from typing import Optional

try:
    import resource
except ImportError:  # Windows local dev
    resource = None  # type: ignore

from .repository import TestCase, Verdict, fetch_test_cases

# NOTE: 进程级隔离（非容器沙箱）：
# - 服务进程（API/worker）以 root 运行，仅用于把判题子进程 setuid 降权到 sandbox 用户（uid 1002）。
# - 用户代码永远以 sandbox 身份运行：无 shell、无 home、不在任何特权组（helper 内 os.setgroups([]) 清空补充组）。
# - 子进程环境变量被清洗（只保留 PATH/HOME/LANG/TMPDIR），DB_PASSWORD/REDIS_URL/AMQP_URL 等凭据不可见。
# - site-packages 权限收紧为 700：sandbox 用户无法 import psycopg2/redis 直连内部服务。
# - 资源限制：RLIMIT_AS（虚拟内存）/RLIMIT_CPU/RLIMIT_FSIZE/RLIMIT_NPROC/RLIMIT_NOFILE，
#   超内存由 ru_maxrss 事后判定 MLE。
# - 输出有界读取：stdout/stderr 各自最多保留 MAX_OUTPUT_CHARS，防止恶意程序刷爆 worker 内存。
# 仍存在的残余风险：用户代码可发起本地网络连接（无 --network=none）。生产加固建议：
# 用独立判题容器 + 子容器执行（--network=none --pids-limit），或 seccomp profile。

EMPTY_SOURCE = "empty source code"
TLE_MSG = "time limit exceeded"
MLE_MSG = "memory limit exceeded"
NO_CASES_MSG = "no test cases configured"
WA_MSG = "wrong answer"
NO_RUNTIME_MSG = "runtime not available for language: {lang}"

TIME_LIMIT_S = 2
COMPILE_TIMEOUT_S = 10  # 编译超时单独放宽到 10 秒
MEMORY_LIMIT_KB = 512 * 1024  # MLE 判定阈值（物理内存峰值）
MAX_OUTPUT_CHARS = 65536
MAX_FILE_SIZE_KB = 64 * 1024  # 子进程单文件最大 64MB
MAX_PROCESSES = 1  # 仅允许子进程本身，禁止 fork 子进程
COMPILE_MAX_PROCESSES = 32  # 编译器需 fork cc1/cc1plus/ld 等子进程，编译阶段放宽
MAX_OPEN_FILES = 64

# sandbox_helper 在 stderr 末尾写入子进程自身的内存峰值（KB），供 engine 解析、避免
# RUSAGE_CHILDREN 累计峰值被一次重编译永久污染导致后续假 MLE；该行不得透传给用户。
RUSAGE_MARKER_RE = re.compile(r"^__SB_RUSAGE__=(\d+)[ \t]*(?:\r\n|\r|\n)?$")

SANDBOX_UID = 1002
SANDBOX_GID = 1001

# 各语言的虚拟内存上限（RLIMIT_AS）：Java JVM 会保留大量虚拟地址空间，需单独放宽
AS_LIMIT_KB_DEFAULT = 1024 * 1024   # 1GB
AS_LIMIT_KB_JAVA = 2048 * 1024      # 2GB（配合 -Xmx256m 限制实际堆）

SANDBOX_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "HOME": "/tmp",
    "LANG": "C.UTF-8",
    "TMPDIR": "/tmp",
}


def _setpriv_cmd(args: list[str], as_limit_kb: int, cpu_s: int,
                 fsize_kb: int, nproc: int, nofile: int) -> list[str]:
    """经 sandbox_helper 降权执行：root 设置 rlimit 后 setuid 到 sandbox 再 exec。
    helper 路径由 engine 所在目录解析；限制参数经环境变量 SB_* 传入。"""
    helper = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sandbox_helper.py")
    env = dict(SANDBOX_ENV)
    env.update({
        "SB_MEM_KB": str(as_limit_kb),
        "SB_CPU_S": str(cpu_s),
        "SB_FSIZE_KB": str(fsize_kb),
        "SB_NPROC": str(nproc),
        "SB_NOFILE": str(nofile),
    })
    return [sys.executable, helper, *args], env


class JudgeEngine(ABC):
    @abstractmethod
    def judge(self, problem_id: int, language: str, source_code: str) -> Verdict:
        raise NotImplementedError

    @abstractmethod
    def run_code(self, language: str, source_code: str, stdin: str = "") -> _RunResult:
        raise NotImplementedError


class _RunResult:
    def __init__(self, status: str, output: str = "", runtime_ms: int = 0, memory_kb: int = 0, error_message: Optional[str] = None):
        self.status = status
        self.output = output
        self.runtime_ms = runtime_ms
        self.memory_kb = memory_kb
        self.error_message = error_message


class RealJudgeEngine(JudgeEngine):
    def judge(self, problem_id: int, language: str, source_code: str) -> Verdict:
        test_cases = fetch_test_cases(problem_id)
        if not test_cases:
            return Verdict(status="RE", error_message=NO_CASES_MSG)

        total_runtime = 0
        peak_memory = 0

        for case in test_cases:
            result = self._run_one(source_code, language, case.input_data)
            total_runtime += result.runtime_ms
            peak_memory = max(peak_memory, result.memory_kb)

            if result.status in {"CE", "TLE", "MLE", "RE"}:
                return Verdict(
                    status=result.status,
                    runtime_ms=total_runtime,
                    memory_kb=peak_memory,
                    error_message=result.error_message or result.output,
                    failed_case_input=case.input_data,
                    expected_output=case.expected_output,
                    actual_output=result.output,
                )

            expected = case.expected_output.strip()
            actual = (result.output or "").strip()
            compact_actual = "".join(actual.split())
            compact_expected = "".join(expected.split())
            if actual != expected and compact_actual != compact_expected:
                return Verdict(
                    status="WA",
                    runtime_ms=total_runtime,
                    memory_kb=peak_memory,
                    error_message=WA_MSG,
                    failed_case_input=case.input_data,
                    expected_output=expected,
                    actual_output=actual,
                )

        return Verdict(status="AC", runtime_ms=total_runtime, memory_kb=peak_memory)

    def run_code(self, language: str, source_code: str, stdin: str = "") -> _RunResult:
        return self._run_one(source_code, language, stdin)

    def _run_one(self, source: str, language: str, input_data: str) -> _RunResult:
        if len(source.strip()) == 0:
            return _RunResult(status="CE", error_message=EMPTY_SOURCE)

        start = time.time()
        try:
            if language in {"python", "py"}:
                return self._run_python(source, input_data, start)
            if language in {"node", "javascript", "js"}:
                return self._run_node(source, input_data, start)
            if language in {"cpp", "c++"}:
                return self._run_cpp(source, input_data, start)
            if language == "c":
                return self._run_c(source, input_data, start)
            if language == "java":
                return self._run_java(source, input_data, start)
            return _RunResult(status="CE", error_message=NO_RUNTIME_MSG.format(lang=language))
        except subprocess.TimeoutExpired:
            return _RunResult(status="TLE", runtime_ms=TIME_LIMIT_S * 1000, error_message=TLE_MSG)
        except FileNotFoundError as exc:
            return _RunResult(status="CE", error_message=f"runtime not installed: {exc}")
        except Exception as exc:
            return _RunResult(status="RE", error_message=str(exc)[:500])

    def _measure(self, start: float) -> tuple[int, int]:
        runtime_ms = int((time.time() - start) * 1000)
        memory_kb = int(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss) if resource is not None else 0
        return runtime_ms, memory_kb

    @staticmethod
    def _strip_rusage(stderr: str) -> tuple[Optional[int], str]:
        """解析并剥离 sandbox_helper 写入的 `__SB_RUSAGE__=<kb>` 标记行。

        返回 (子进程自身峰值内存 KB, 剥离后的 stderr)。helper 的标记行总是
        stderr 的最后一行（wait4 之后写入），因此仅当最后一行是标记行时才采信；
        标记行被输出截断吞掉、或末尾是用户伪造的同名行时返回 (None, stderr)，
        调用方回退到 _measure() 的累计值。剥离时删除所有匹配行，避免用户伪造
        的干扰行出现在 RE/CE 输出里。"""
        lines = stderr.splitlines(keepends=True)
        if not lines:
            return None, stderr
        # 输出达到上限说明读取被截断：helper 的标记行在末尾，必然已丢失或残缺，
        # 此时最后一行可能是用户伪造的干扰行，一律不采信
        if len(stderr) >= MAX_OUTPUT_CHARS:
            return None, stderr
        m = RUSAGE_MARKER_RE.match(lines[-1])
        if m is None:
            return None, stderr
        cleaned = "".join(line for line in lines if RUSAGE_MARKER_RE.match(line) is None)
        return int(m.group(1)), cleaned

    @staticmethod
    def _truncate(text: str) -> str:
        return text[:MAX_OUTPUT_CHARS]

    def _communicate_capped(self, proc: subprocess.Popen, input_data: str, timeout: float) -> tuple[str, str]:
        """有界读取 stdout/stderr：各自最多保留 MAX_OUTPUT_CHARS 字符，
        超出部分继续读但丢弃（防止恶意输出撑爆 worker 内存，也避免管道阻塞导致死锁）。
        Windows 本地开发回退到 communicate（select 不支持 pipe）。"""
        if os.name == "nt":
            if proc.stdin is not None and input_data:
                stdout, stderr = proc.communicate(input=input_data)
            else:
                stdout, stderr = proc.communicate()
            return self._truncate(stdout or ""), self._truncate(stderr or "")
        out_chunks: list[str] = []
        err_chunks: list[str] = []
        out_len = err_len = 0
        if proc.stdin is not None:
            try:
                proc.stdin.write(input_data)
            except (BrokenPipeError, OSError):
                pass
            try:
                proc.stdin.close()
            except OSError:
                pass

        deadline = time.time() + timeout
        fds = {proc.stdout, proc.stderr}
        eof: set = set()
        try:
            while fds and len(eof) < 2:
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(proc.args, timeout)
                try:
                    readable, _, _ = select.select(list(fds), [], [], remaining)
                except OSError:
                    break
                if not readable:
                    continue
                for fd in readable:
                    try:
                        data = os.read(fd.fileno(), 65536)
                    except OSError:
                        eof.add(fd)
                        fds.discard(fd)  # EOF 的 fd 对 select 永远就绪，须移除避免忙轮询
                        continue
                    if not data:
                        eof.add(fd)
                        fds.discard(fd)
                        continue
                    text = data.decode("utf-8", "replace")
                    cap = MAX_OUTPUT_CHARS - (out_len if fd is proc.stdout else err_len)
                    if cap > 0:
                        take = text[:cap]
                        if fd is proc.stdout:
                            out_chunks.append(take)
                            out_len += len(take)
                        else:
                            err_chunks.append(take)
                            err_len += len(take)
            # EOF 后进程可能仍在运行（用户代码关闭 fd 后 sleep 死循环，不耗 CPU、
            # RLIMIT_CPU 不触发）：wait 必须带剩余时间超时，否则恶意提交可永久
            # 卡死判题 worker。超时抛 TimeoutExpired 走下方 killpg 路径。
            remaining = deadline - time.time()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(proc.args, timeout)
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
            raise
        return "".join(out_chunks), "".join(err_chunks)

    def _run_subprocess(self, args: list[str], input_data: str, start: float,
                        cwd: Optional[str] = None, as_limit_kb: int = AS_LIMIT_KB_DEFAULT) -> _RunResult:
        """统一执行沙箱子进程：sandbox_helper 降权到 sandbox + 清洗环境 + 资源限制，
        使用 start_new_session 创建独立进程组，超时时向整个进程组发 SIGKILL。"""
        cmd, cmd_env = _setpriv_cmd(
            args,
            as_limit_kb=as_limit_kb,
            cpu_s=TIME_LIMIT_S,
            fsize_kb=MAX_FILE_SIZE_KB,
            nproc=MAX_PROCESSES,
            nofile=MAX_OPEN_FILES,
        )
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
            env=cmd_env,
            cwd=cwd or "/tmp",
        )
        try:
            stdout, stderr = self._communicate_capped(proc, input_data, TIME_LIMIT_S)
        except subprocess.TimeoutExpired:
            return _RunResult(status="TLE", runtime_ms=TIME_LIMIT_S * 1000, error_message=TLE_MSG)
        runtime_ms, rusage_memory_kb = self._measure(start)
        # 优先用 helper 报告的【子进程自身】峰值；被输出截断时回退累计值（极端输出场景）
        sb_memory_kb, stderr = self._strip_rusage(stderr)
        memory_kb = sb_memory_kb if sb_memory_kb is not None else rusage_memory_kb
        if proc.returncode != 0:
            # RLIMIT_CPU 触发 SIGXCPU(24)，RLIMIT_FSIZE 触发 SIGXFSZ(25)
            if proc.returncode in (-signal.SIGXCPU, signal.SIGXCPU):
                return _RunResult(status="TLE", runtime_ms=runtime_ms, error_message=TLE_MSG)
            if memory_kb > MEMORY_LIMIT_KB:
                return _RunResult(status="MLE", output=self._truncate((stderr or "").strip() or (stdout or "").strip()),
                                  runtime_ms=runtime_ms, memory_kb=memory_kb, error_message=MLE_MSG)
            return _RunResult(
                status="RE",
                output=self._truncate((stderr or "").strip() or (stdout or "").strip()),
                runtime_ms=runtime_ms,
                memory_kb=memory_kb,
            )
        if memory_kb > MEMORY_LIMIT_KB:
            return _RunResult(status="MLE", output=self._truncate(stdout or ""),
                              runtime_ms=runtime_ms, memory_kb=memory_kb, error_message=MLE_MSG)
        return _RunResult(status="OK", output=self._truncate(stdout or ""), runtime_ms=runtime_ms, memory_kb=memory_kb)

    def _run_python(self, source: str, input_data: str, start: float) -> _RunResult:
        python_bin = shutil.which("python3") or "python"
        return self._run_subprocess([python_bin, "-c", source], input_data, start)

    def _run_node(self, source: str, input_data: str, start: float) -> _RunResult:
        # 限制 V8 堆上限，避免 Node 默认堆把虚拟内存吃满
        return self._run_subprocess(["node", "--max-old-space-size=256", "-e", source], input_data, start)

    def _run_binary(self, exe: str, input_data: str, start: float, cwd: str) -> _RunResult:
        return self._run_subprocess([exe], input_data, start, cwd=cwd)

    def _run_compile(self, args: list[str], cwd: str) -> tuple[int, str, str]:
        """编译子进程：同样降权到 sandbox + 清洗环境。
        编译放宽内存（编译器需要更多资源）与文件大小，仅设 CPU 超时。"""
        cmd, cmd_env = _setpriv_cmd(
            args,
            as_limit_kb=AS_LIMIT_KB_JAVA,
            cpu_s=COMPILE_TIMEOUT_S,
            fsize_kb=MAX_FILE_SIZE_KB * 2,
            nproc=COMPILE_MAX_PROCESSES,
            nofile=MAX_OPEN_FILES,
        )
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
            env=cmd_env,
            cwd=cwd,
        )
        try:
            stdout, stderr = self._communicate_capped(proc, "", COMPILE_TIMEOUT_S)
            _, stderr = self._strip_rusage(stderr)
            return proc.returncode, stdout or "", stderr or ""
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                proc.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            return -1, "", "compilation timed out"

    @staticmethod
    def _chown_sandbox_workdir(path: str) -> None:
        """把判题工作目录所有权交给 sandbox 用户并用 700 收权（替代 777）：
        其他沙箱进程不可读/改本判题的工作目录。非 root（本地开发）时跳过
        chown——目录已是调用者私有，chmod 700 仍生效。"""
        try:
            os.chown(path, SANDBOX_UID, SANDBOX_GID)
        except (OSError, AttributeError):  # AttributeError: Windows 无 os.chown（本地开发）
            pass
        os.chmod(path, 0o700)

    def _make_workdir(self) -> str:
        """创建 sandbox 可写的工作目录（worker 是 root，必须显式放权给 sandbox 用户）。"""
        tmp = tempfile.mkdtemp(prefix="polycode-judge-")
        self._chown_sandbox_workdir(tmp)
        return tmp

    def _run_cpp(self, source: str, input_data: str, start: float) -> _RunResult:
        with tempfile.TemporaryDirectory(prefix="polycode-judge-") as tmp:
            self._chown_sandbox_workdir(tmp)
            src_path = os.path.join(tmp, "main.cpp")
            with open(src_path, "w", encoding="utf-8") as fh:
                fh.write(source)
            rc, out, err = self._run_compile(
                ["g++", "-O2", "-std=c++17", "-o", os.path.join(tmp, "main"), src_path],
                cwd=tmp,
            )
            if rc != 0:
                runtime_ms, memory_kb = self._measure(start)
                return _RunResult(
                    status="CE",
                    output=self._truncate((err or "").strip() or (out or "").strip()),
                    runtime_ms=runtime_ms,
                    memory_kb=memory_kb,
                )
            return self._run_binary(os.path.join(tmp, "main"), input_data, start, cwd=tmp)

    def _run_c(self, source: str, input_data: str, start: float) -> _RunResult:
        with tempfile.TemporaryDirectory(prefix="polycode-judge-") as tmp:
            self._chown_sandbox_workdir(tmp)
            src_path = os.path.join(tmp, "main.c")
            with open(src_path, "w", encoding="utf-8") as fh:
                fh.write(source)
            rc, out, err = self._run_compile(
                ["gcc", "-O2", "-std=c11", "-o", os.path.join(tmp, "main"), src_path],
                cwd=tmp,
            )
            if rc != 0:
                runtime_ms, memory_kb = self._measure(start)
                return _RunResult(
                    status="CE",
                    output=self._truncate((err or "").strip() or (out or "").strip()),
                    runtime_ms=runtime_ms,
                    memory_kb=memory_kb,
                )
            return self._run_binary(os.path.join(tmp, "main"), input_data, start, cwd=tmp)

    def _run_java(self, source: str, input_data: str, start: float) -> _RunResult:
        with tempfile.TemporaryDirectory(prefix="polycode-judge-") as tmp:
            self._chown_sandbox_workdir(tmp)
            src_path = os.path.join(tmp, "Main.java")
            with open(src_path, "w", encoding="utf-8") as fh:
                fh.write(source)
            rc, out, err = self._run_compile(
                ["javac", "-J-Xmx512m", "-J-XX:CompressedClassSpaceSize=256m", "-encoding", "UTF-8", src_path],
                cwd=tmp,
            )
            if rc != 0:
                runtime_ms, memory_kb = self._measure(start)
                return _RunResult(
                    status="CE",
                    output=self._truncate((err or "").strip() or (out or "").strip()),
                    runtime_ms=runtime_ms,
                    memory_kb=memory_kb,
                )
            return self._run_subprocess(
                ["java", "-Xmx256m", "-Xss64m", "-cp", tmp, "Main"],
                input_data,
                start,
                cwd=tmp,
                as_limit_kb=AS_LIMIT_KB_JAVA,
            )


class SimulatedJudgeEngine(JudgeEngine):
    def judge(self, problem_id: int, language: str, source_code: str) -> Verdict:
        test_cases = fetch_test_cases(problem_id)
        if not test_cases:
            return Verdict(status="RE", error_message=NO_CASES_MSG)

        if "pass_all" not in source_code:
            return Verdict(
                status="WA",
                runtime_ms=1,
                memory_kb=1024,
                error_message="simulated judge: add 'pass_all' to pass",
            )

        total_runtime = 0
        peak_memory = 0
        for case in test_cases:
            if case.input_data.strip() != case.expected_output.strip():
                return Verdict(
                    status="WA",
                    runtime_ms=1,
                    memory_kb=1024,
                    error_message="simulated judge: mismatched case",
                )
            total_runtime += 4
            peak_memory = 2048
        return Verdict(status="AC", runtime_ms=total_runtime, memory_kb=peak_memory)

    def run_code(self, language: str, source_code: str, stdin: str = "") -> _RunResult:
        return _RunResult(
            status="OK" if "pass_all" in source_code else "WA",
            output=stdin,
            runtime_ms=1,
            memory_kb=1024,
        )


def create_engine() -> JudgeEngine:
    if os.environ.get("JUDGE_ENGINE") == "mock":
        return SimulatedJudgeEngine()
    return RealJudgeEngine()
