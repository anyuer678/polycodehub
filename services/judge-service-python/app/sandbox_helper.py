"""判题沙箱助手：以 root 启动，设置资源限制后 fork 降权执行用户代码。

用法: python3 sandbox_helper.py <cmd...>
限制通过环境变量 SB_* 传入（由 engine.py 注入，均为非敏感值）：
  SB_MEM_KB    RLIMIT_AS 虚拟内存上限（KB）
  SB_CPU_S     RLIMIT_CPU 秒数
  SB_FSIZE_KB  RLIMIT_FSIZE 单文件上限（KB）
  SB_NPROC     RLIMIT_NPROC 进程数（在 setuid 后设置，只约束 sandbox 用户；
               设 SB_CGROUP 时跳过——fork 炸弹防护改由 cgroup pids.max 按判题隔离）
  SB_NOFILE    RLIMIT_NOFILE 文件描述符数
  SB_CGROUP    （opt-in）判题专属 cgroup v2 目录：子进程附着（fail-closed）、
               pids.max/memory.max 由 engine 预设

fork 模式：父进程（root）在子进程结束后用 wait4 取【子进程自身】的 rusage，
将物理内存峰值以 `__SB_RUSAGE__=<kb>` 一行写入 stderr，供 engine.py 解析——
避免 worker 进程级 RUSAGE_CHILDREN 累计峰值导致的永久性假 MLE。
cgroup 模式额外写 `__SB_CGROUP__=<peak_kb>,oom=<n>`（memory.peak 含 page cache、
memory.events 的 oom_kill 为 OOM 显式证据；读取失败容错降级，不影响主流程）。

安全层次：
  1. setuid 降权到 sandbox (uid 1002) + 清空补充组
  2. cgroup v2（opt-in，SB_CGROUP）：pids.max 按判题隔离 fork 炸弹 + memory.max 硬上限
  3. seccomp 纵深防御（sandbox_netblock）：黑名单（默认）/ 白名单（SB_PROFILE），
     阻止网络/调试/挂载/reboot/io_uring
  4. rlimit 资源限制（内存/CPU/文件大小/文件描述符；NPROC 仅非 cgroup 模式）
  5. 环境变量清洗（仅保留 PATH/HOME/LANG/TMPDIR）
  6. site-packages chmod 700（sandbox 用户不可读）
"""
import os
import resource
import sys

# 允许 CI/本地用环境变量覆盖 UID/GID 与 netblock 路径（默认与生产一致）
SANDBOX_UID = int(os.environ.get("SB_SANDBOX_UID", "1002"))
SANDBOX_GID = int(os.environ.get("SB_SANDBOX_GID", "1001"))

# 网络隔离工具：sandbox_netblock（C + libseccomp，Dockerfile 编译到 /usr/local/bin）。
# 它在 exec 用户代码前设置 seccomp filter：阻止网络/调试/挂载/reboot/io_uring。
NETBLOCK_BIN = os.environ.get("SANDBOX_NETBLOCK", "/usr/local/bin/sandbox_netblock")

# 仅保留这些键给用户代码；绝不透传 DB/Redis/AMQP/JWT 等凭据。
ALLOWED_SANDBOX_ENV_KEYS = frozenset({"PATH", "HOME", "LANG", "TMPDIR"})

DEFAULT_LIMITS = {
    "SB_MEM_KB": 1048576,
    "SB_CPU_S": 2,
    "SB_FSIZE_KB": 65536,
    "SB_NPROC": 1,
    "SB_NOFILE": 64,
}


def _read_int(path: str) -> int | None:
    """容错读整数文件（cgroup 遥测用）；失败返回 None，不影响判题主流程。"""
    try:
        with open(path, encoding="utf-8") as f:
            return int(f.read().strip() or "0")
    except (OSError, ValueError):
        return None


def _read_oom_kills(cgroup_path: str) -> int | None:
    """memory.events 的 oom_kill 计数；文件缺失（旧内核）返回 None。"""
    try:
        with open(os.path.join(cgroup_path, "memory.events"), encoding="utf-8") as f:
            for line in f:
                if line.startswith("oom_kill"):
                    return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return None


def resolve_sandbox_ids(environ: dict | None = None) -> tuple[int, int]:
    """读取 uid/gid（可用 SB_SANDBOX_UID/GID 覆盖，默认 1002/1001）。"""
    env = os.environ if environ is None else environ
    uid = int(env.get("SB_SANDBOX_UID", "1002"))
    gid = int(env.get("SB_SANDBOX_GID", "1001"))
    return uid, gid


def resolve_netblock(environ: dict | None = None) -> str:
    env = os.environ if environ is None else environ
    return env.get("SANDBOX_NETBLOCK", "/usr/local/bin/sandbox_netblock")


def parse_sb_limits(environ: dict | None = None) -> dict[str, int]:
    """解析 SB_* 资源限制；缺省用 DEFAULT_LIMITS，非法值抛 ValueError。"""
    env = os.environ if environ is None else environ
    out: dict[str, int] = {}
    for key, default in DEFAULT_LIMITS.items():
        raw = env.get(key)
        if raw is None or raw == "":
            out[key] = default
            continue
        try:
            out[key] = int(raw)
        except ValueError as exc:
            raise ValueError(f"invalid {key}: {raw!r}") from exc
        if out[key] < 0:
            raise ValueError(f"negative {key}: {raw!r}")
    return out


def netblock_ready(path: str) -> bool:
    """netblock 必须是存在的可执行文件，否则 fail-closed。"""
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def scrubbed_sandbox_env(base: dict | None = None) -> dict[str, str]:
    """环境清洗：只保留 ALLOWED_SANDBOX_ENV_KEYS 中的白名单键。"""
    src = base if base is not None else {}
    cleaned: dict[str, str] = {}
    for key in ALLOWED_SANDBOX_ENV_KEYS:
        if key in src:
            cleaned[key] = str(src[key])
    return cleaned


def main() -> int:
    args = sys.argv[1:]
    if not args:
        return 2

    limits = parse_sb_limits()
    mem_kb = limits["SB_MEM_KB"]
    cpu_s = limits["SB_CPU_S"]
    fsize_kb = limits["SB_FSIZE_KB"]
    nproc = limits["SB_NPROC"]
    nofile = limits["SB_NOFILE"]
    SANDBOX_UID, SANDBOX_GID = resolve_sandbox_ids()
    netblock_bin = resolve_netblock()

    # root 阶段设置硬限制（降权后无法再放宽）
    resource.setrlimit(resource.RLIMIT_AS, (mem_kb * 1024, mem_kb * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_kb * 1024, fsize_kb * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    pid = os.fork()
    if pid == 0:
        # cgroup 附着（以 root 写入：ns/非 ns 均在此完成，先附着再降权/chroot，
        # 保证 exec 用户代码时已受控；失败即 fail-closed 拒绝判题）。
        sb_cgroup = os.environ.get("SB_CGROUP", "")
        if sb_cgroup:
            try:
                with open(os.path.join(sb_cgroup, "cgroup.procs"), "w") as f:
                    f.write(str(os.getpid()))
            except OSError as exc:
                os.write(2, f"__SB_ERROR__=cgroup attach failed: {exc}\n".encode())
                os._exit(125)
        sb_ns = os.environ.get("SB_NS", "")
        if not sb_ns:
            # 历史路径：降权到 sandbox 后调 netblock（netblock 仅做 seccomp）。
            # 非降权阶段设 NPROC（此时 sandbox 用户仅有自身 1 个进程，之后 fork 即被拒）。
            try:
                # 先清空 root 继承的补充组（需 root 权限，必须在 setuid 前），
                # 否则子进程虽切换了主组/UID 但仍处于特权补充组中
                os.setgroups([])
                os.setgid(SANDBOX_GID)
                os.setuid(SANDBOX_UID)
            except OSError as exc:
                os.write(2, f"__SB_ERROR__=setuid failed: {exc}\n".encode())
                os._exit(126)
            if not sb_cgroup:
                try:
                    resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))
                except OSError as exc:
                    # 静默失败会让 fork 炸弹防护失效（多 worker 并发时 sandbox 用户已有
                    # 其他子进程，setrlimit 会因进程数超过新软限制而失败）——必须可见
                    os.write(2, f"__SB_ERROR__=setrlimit NPROC failed: {exc}\n".encode())
                    os._exit(125)
        else:
            # ns 模式：netblock 以 root 完成 unshare(NET/PID/MOUNT) → 构建 jail 根
            # → chroot → 降权（SB_UID/SB_GID）→ seccomp → exec 用户代码。
            # fork 炸弹防护由 cgroup pids.max（优先）或 netblock 内部 NPROC 接管。
            pass
        # 经 sandbox_netblock 设置安全隔离后再 exec 用户代码；
        # 工具缺失时拒绝执行（fail-closed），防止用户代码绕过安全限制
        if not netblock_ready(netblock_bin):
            os.write(2, b"__SB_ERROR__=sandbox_netblock missing or not executable; refuse to judge\n")
            os._exit(125)
        cmd = [netblock_bin, *args]
        try:
            os.execvp(cmd[0], cmd)
        except OSError as exc:
            os.write(2, f"__SB_ERROR__=exec failed: {exc}\n".encode())
            os._exit(127)

    # 父进程（root）：wait4 拿子进程自身的 rusage（非进程累计值）
    _, status, ru = os.wait4(pid, 0)
    maxrss_kb = getattr(ru, "ru_maxrss", 0) or 0
    # cgroup 遥测（容错降级：读不到就不写标记，engine 回退 rusage）
    sb_cgroup = os.environ.get("SB_CGROUP", "")
    if sb_cgroup:
        peak = _read_int(os.path.join(sb_cgroup, "memory.peak"))
        oom = _read_oom_kills(sb_cgroup)
        if peak is not None or oom is not None:
            try:
                os.write(2, f"__SB_CGROUP__={peak or 0},oom={oom or 0}\n".encode())
            except OSError:
                pass
    try:
        os.write(2, f"__SB_RUSAGE__={maxrss_kb}\n".encode())
    except OSError:
        pass
    if os.WIFSIGNALED(status):
        # 以相同信号退出，engine.py 可识别 SIGXCPU(24) 判定 TLE
        os.kill(os.getpid(), os.WTERMSIG(status))
    return os.WEXITSTATUS(status) if os.WIFEXITED(status) else 1


if __name__ == "__main__":
    sys.exit(main())
