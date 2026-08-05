"""判题沙箱助手：以 root 启动，设置资源限制后 fork 降权执行用户代码。

用法: python3 sandbox_helper.py <cmd...>
限制通过环境变量 SB_* 传入（由 engine.py 注入，均为非敏感值）：
  SB_MEM_KB    RLIMIT_AS 虚拟内存上限（KB）
  SB_CPU_S     RLIMIT_CPU 秒数
  SB_FSIZE_KB  RLIMIT_FSIZE 单文件上限（KB）
  SB_NPROC     RLIMIT_NPROC 进程数（在 setuid 后设置，只约束 sandbox 用户）
  SB_NOFILE    RLIMIT_NOFILE 文件描述符数

fork 模式：父进程（root）在子进程结束后用 wait4 取【子进程自身】的 rusage，
将物理内存峰值以 `__SB_RUSAGE__=<kb>` 一行写入 stderr，供 engine.py 解析——
避免 worker 进程级 RUSAGE_CHILDREN 累计峰值导致的永久性假 MLE。
"""
import os
import resource
import sys

SANDBOX_UID = 1002
SANDBOX_GID = 1001

# 网络隔离工具：sandbox_netblock（C + libseccomp，Dockerfile 编译到 /usr/local/bin）。
# 它在 exec 用户代码前设置 seccomp filter（禁 IPv4/IPv6 socket）。
NETBLOCK_BIN = "/usr/local/bin/sandbox_netblock"


def main() -> int:
    args = sys.argv[1:]
    if not args:
        return 2

    mem_kb = int(os.environ.get("SB_MEM_KB", "1048576"))
    cpu_s = int(os.environ.get("SB_CPU_S", "2"))
    fsize_kb = int(os.environ.get("SB_FSIZE_KB", "65536"))
    nproc = int(os.environ.get("SB_NPROC", "1"))
    nofile = int(os.environ.get("SB_NOFILE", "64"))

    # root 阶段设置硬限制（降权后无法再放宽）
    resource.setrlimit(resource.RLIMIT_AS, (mem_kb * 1024, mem_kb * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_s, cpu_s + 1))
    resource.setrlimit(resource.RLIMIT_FSIZE, (fsize_kb * 1024, fsize_kb * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (nofile, nofile))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    pid = os.fork()
    if pid == 0:
        # 子进程：降权到 sandbox 后再设 NPROC（此时 sandbox 用户仅有自身 1 个进程，
        # 用户代码之后 fork 任何子进程都会被拒绝），然后执行用户代码。
        try:
            # 先清空 root 继承的补充组（需 root 权限，必须在 setuid 前），
            # 否则子进程虽切换了主组/UID 但仍处于特权补充组中
            os.setgroups([])
            os.setgid(SANDBOX_GID)
            os.setuid(SANDBOX_UID)
        except OSError as exc:
            os.write(2, f"__SB_ERROR__=setuid failed: {exc}\n".encode())
            os._exit(126)
        # 经 sandbox_netblock 设置 seccomp 网络隔离后再 exec 用户代码；
        # 工具缺失时降级直接 exec 并警告（生产 Dockerfile 必须编译它）
        cmd = [NETBLOCK_BIN, *args] if os.path.exists(NETBLOCK_BIN) else args
        if cmd is args:
            os.write(2, b"__SB_WARN__=sandbox_netblock missing, network NOT isolated\n")
        try:
            resource.setrlimit(resource.RLIMIT_NPROC, (nproc, nproc))
        except OSError as exc:
            # 静默失败会让 fork 炸弹防护失效（多 worker 并发时 sandbox 用户已有
            # 其他子进程，setrlimit 会因进程数超过新软限制而失败）——必须可见
            os.write(2, f"__SB_WARN__=setrlimit NPROC failed: {exc}\n".encode())
        try:
            os.execvp(cmd[0], cmd)
        except OSError as exc:
            os.write(2, f"__SB_ERROR__=exec failed: {exc}\n".encode())
            os._exit(127)

    # 父进程（root）：wait4 拿子进程自身的 rusage（非进程累计值）
    _, status, ru = os.wait4(pid, 0)
    maxrss_kb = getattr(ru, "ru_maxrss", 0) or 0
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
