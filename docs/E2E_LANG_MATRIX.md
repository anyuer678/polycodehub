# Multi-language judge E2E (Docker stack)

Date: 2026-09-22 · problem: Two Sum (id=1) · sample [2,7,11,15] + 9 → [0,1]

| Language | Verdict | Runtime/Mem |
|----------|---------|-------------|
| python | **AC** | 65ms / 10MB |
| javascript | **AC** | 224ms / 51MB |
| cpp | **AC** | 2435ms / 6MB |
| java | **AC** | 1111ms / 40MB |

Also verified earlier: wrong answer → **WA**; while True → **TLE** (2s).

## Root-cause notes

| Finding | Fix |
|---------|-----|
| RLIMIT_NPROC=1 broke Node worker threads / JVM pthreads (EAGAIN → RE) | Language-aware NPROC (py=4, node=16, jvm=128, native=2) |
| /tmp tmpfs on judge-worker is **noexec** → execvp: Permission denied for compiled C/C++ | Compile/run under JUDGE_WORK_ROOT=/app/judge-work (exec-capable) |
| JVM -Xss64m + high thread count failed | -Xss2m + ActiveProcessorCount + SerialGC |
| C++ binary umask | _ensure_exec chmod 0755 + chown sandbox |

Image self-check: sandbox uid 1002, netblock executable, fail-closed when missing.

Known residual: seccomp **blacklist** is not gVisor; AF_UNIX local sockets remain allowed.
