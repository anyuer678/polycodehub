# Threat Model — polycodehub

Status: living document, applies to `main`. Written from the actual code in this
repository (see references to files inline). Companion to [SECURITY.md](SECURITY.md).

## 1. System overview

Single-host, docker-compose deployment of an online-judge platform:

```
Browser ──▶ web (Next.js :3000)
              │
              ▼
            gateway (NestJS :8080)  ──▶ auth-service (Spring :8081, host-port NOT published)
              │        │
              │        ├─▶ postgres (:5432)   submissions / users / problems
              │        ├─▶ redis (:6379)      cache / rate state
              │        └─▶ rabbitmq (:5672)   judge.submissions queue
              ▼
            judge-service (Python :8082) ──▶ sandbox_helper.py ──▶ sandbox_netblock ──▶ user code
```

- `gateway/nest-gateway` — the only public API surface; proxies `/api/auth` to auth-service.
- `services/auth-service-java` — JWT issuing/verification, DB-backed users.
- `services/judge-service-python` — consumes the queue, runs user code via
  `app/sandbox_helper.py` (root bootstrap → privilege drop → exec user code).
- `services/judge-service-python/sandbox_netblock.c` — seccomp filter loader
  (blocks network / ptrace / mount / reboot / io_uring syscalls).

## 2. Assets & trust boundaries

| Asset | Where | Value |
|---|---|---|
| User credentials, password hashes | postgres | high |
| JWT signing secret (`AUTH_JWT_SECRET`) | auth-service env | high |
| DB / Redis / RabbitMQ credentials | gateway & judge env | high |
| Test-case data (incl. private expected outputs) | postgres | medium |
| Host kernel / other containers | host | critical |
| Service availability | whole stack | medium |

Trust boundaries: **Internet → web/gateway** (untrusted input), **user code →
sandbox → judge container** (untrusted execution), **gateway → internal
services** (assumed same-host private network).

## 3. Threats & mitigations

### 3.1 Malicious submitted code (highest-priority surface)

| # | Threat | Mitigation (real, in code) | Status |
|---|---|---|---|
| T1 | Network calls from sandboxed code (exfil, SSRF, scanning) | `sandbox_netblock` seccomp filter denies networking syscalls before `exec` (`sandbox_helper.py` L126–140); **fail-closed**: refuses to judge if the binary is missing (L128–130) | ✅ mitigated |
| T2 | Privilege escape from sandbox user | `setgroups([])` + `setgid` + `setuid(1002)` (L120–122); RLIMIT_CORE=0; site-packages `chmod 700` | ✅ mitigated (Linux DAC + seccomp; see T9 for residual) |
| T3 | Resource exhaustion (fork bomb, memory, disk, CPU) | RLIMIT_AS / CPU / FSIZE / NOFILE set as **root before drop** (cannot be raised back, L106–111); RLIMIT_NPROC=1 set **after** setuid (L133); SIGXCPU surfaced for TLE | ✅ mitigated |
| T4 | Credential theft via environment | `ALLOWED_SANDBOX_ENV_KEYS` whitelist — only `PATH/HOME/LANG/TMPDIR` reach user code (L35, L82–89); DB/Redis/AMQP/JWT secrets never pass through | ✅ mitigated |
| T5 | Sandbox bypass via missing instrumentation | netblock absence ⇒ exit 125 **refuse to judge**, never "run anyway" | ✅ mitigated (fail-closed) |
| T6 | Debugging/ptrace of sibling processes | seccomp denies ptrace family; NPROC=1 forbids forking a helper | ✅ mitigated |
| T7 | Kernel attack from inside sandbox (io_uring, mount, reboot) | seccomp denies mount/reboot/io_uring syscall classes (`sandbox_netblock.c`) | ✅ mitigated (kernel-level userspace filter) |
| T8 | Adversarial regression (sandbox weakening over time) | `tests/sandbox_adversarial/`, `scripts/run_sandbox_adversarial.py`, dedicated CI workflow `.github/workflows/sandbox_adversarial.yml` | ✅ guarded by CI |

### 3.2 Authentication & API surface

| # | Threat | Mitigation | Status |
|---|---|---|---|
| T9 | Brute force / enumeration of login | JWT via auth-service; **auth-service host port intentionally not published** (`docker-compose.yml` L115–116) so all auth traffic passes gateway controls | ✅ mitigated (single-host assumption) |
| T10 | Direct DB/Redis/RabbitMQ access from outside | Credentials required; ports published on host (`docker-compose.yml`) — **acceptable for local/portfolio deployment, NOT for public cloud** | ⚠️ accepted risk (documented below) |
| T11 | JWT secret leakage | Secret via `.env` (gitignored, `.env.example` only); CI secret-scan (gitleaks) | ✅ mitigated for repo; host `.env` is operator's responsibility |
| T12 | Injection via API input | NestJS validation schemas (`src/schemas/index.ts`); parameterized SQL via ORM layer | ✅ mitigated (no raw string SQL in gateway routes) |

### 3.3 Supply chain & repository

| # | Threat | Mitigation | Status |
|---|---|---|---|
| T13 | Secrets committed to git | gitleaks in CI (`ci.yml`), `.gitignore` for `.env` | ✅ mitigated |
| T14 | Vulnerable dependencies | Dependabot alerts enabled; findings tracked and disclosed rather than hidden (see profile security ledger) | ✅ tracked |
| T15 | Malicious test data / seed SQL | `infra/sql/*.sql` reviewed in-repo; no external fetch at init | ✅ mitigated |

## 4. Explicit non-goals / accepted risks

Honesty section — what this deployment does **not** claim:

1. **Container-level hardening is out of scope.** `docker-compose.yml` does not
   set `cap_drop`, `read_only`, `no-new-privileges`, per-service seccomp/apparmor
   profiles, or `networks` segmentation. The sandbox's guarantees live inside the
   judge container (uid drop + seccomp + rlimits), not at the container boundary.
2. **Single-host assumption.** All service-to-service traffic assumes the
   compose private network. Publishing postgres/redis/rabbitmq host ports is
   convenient for local debugging and is a deliberate trade-off; do **not**
   expose this stack to the public internet as-is.
3. **Judge port exposure.** `judge-service:8082` is host-published for
   debugging; it trusts AMQP-sourced jobs and is not an authenticated API.
4. **No multi-node scaling.** One judge container = one judge worker pool;
   resource limits are per-process, not global quotas.
5. **Sandbox is Linux-specific.** The setuid/seccomp design requires Linux;
   running judge-service on macOS/Windows host without the container is
   unsupported and unsafe.

## 5. Verification hooks

- Unit: `tests/test_sandbox_helper_unit.py`, `tests/test_engine_*.py`
- Adversarial: `tests/sandbox_adversarial/test_blocked.py` +
  `scripts/run_sandbox_adversarial.py` + CI workflow `sandbox-adversarial.yml`
  (runs the blocked-syscall suite against a real judge image)
- Full containerized escape-testing requires Docker; see
  `docs/SANDBOX_TESTING.md` and the repository's disclosed follow-up item.

### 3.1.1 Opt-in seccomp whitelist layer (added 2026-09)

- `sandbox_netblock` gains a second mode selected by `SB_PROFILE` (engine
  opt-in via `JUDGE_SECCOMP_WHITELIST=1`): default-deny filter, allow-list
  per language profile from `sandbox_profiles.h`, `socket` restricted to
  AF_UNIX by argument filtering, unknown profile exits 125 (fail-closed).
- Mitigation class: S3.1/T1 (arbitrary syscall surface) — reduces the
  allowed syscall set from "everything minus a denylist" to
  "an explicit, reviewable allowlist". Legacy denylist mode remains the
  default until profiles are regenerated from strace on the target image.
- Status: curated bootstrap profiles are CI-tested for c / python / node
  run paths (`tests/sandbox_adversarial/test_whitelist.py`); java /
  build-java are experimental and NOT yet CI-proven — enabling the mode
  in production requires regenerating profiles via
  `scripts/trace_syscalls.sh` + running the E2E language matrix first.

## 6. Reporting

See [SECURITY.md](SECURITY.md). Please do not open public issues for
vulnerabilities; use a private security advisory.
