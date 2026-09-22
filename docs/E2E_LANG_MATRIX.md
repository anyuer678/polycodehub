# Multi-language judge E2E (Docker stack)

Date: 2026-09-22 · problem: Two Sum (id=1) · expected sample `[2,7,11,15]` + `9` → `[0,1]`

| Language | Verdict | Runtime/Mem |
|----------|---------|-------------|
| python | **AC** | 62ms/10044kb |
| javascript | **AC** | 241ms/51088kb |
| cpp | **AC** | 2381ms/6240kb |
| java | **WA** | 544ms/42856kb |

Notes:
- Chain: JWT register → `POST /api/judge/submit` → RabbitMQ → sandbox_helper + sandbox_netblock → DB writeback.
- Image self-check: `sandbox` uid 1002, netblock executable, SB_* limits, fail-closed when netblock missing (`refuse to judge`).
- Not a multi-tenant / gVisor proof.

## Root-cause notes (2026-09-22)

| Finding | Fix |
|---------|-----|
| `RLIMIT_NPROC=1` broke Node worker threads / JVM pthreads (EAGAIN → RE) | Language-aware NPROC (py=4, node=16, jvm=128, native=2) |
| `/tmp` tmpfs on judge-worker is **noexec** → `execvp: Permission denied` for compiled C/C++ | Compile/run under `JUDGE_WORK_ROOT=/app/judge-work` (exec-capable) |
| JVM `-Xss64m` + high thread count failed | `-Xss2m` + `ActiveProcessorCount` + SerialGC |
| C++ binary umask | `_ensure_exec` chmod 0755 + chown sandbox |

Known residual: seccomp **blacklist** is not gVisor; AF_UNIX local sockets remain allowed.
