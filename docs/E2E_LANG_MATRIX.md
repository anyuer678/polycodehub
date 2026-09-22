# Multi-language judge E2E (Docker stack)

Date: 2026-09-22 · problem: Two Sum (id=1) · expected sample `[2,7,11,15]` + `9` → `[0,1]`

| Language | Verdict | Runtime/Mem |
|----------|---------|-------------|
| python | **AC** | 63ms/9984kb |
| javascript | **RE** | 377ms/28664kb |
| cpp | **RE** | 1315ms/6232kb |
| java | **CE** | 124ms/206716kb |

Notes:
- Chain: JWT register → `POST /api/judge/submit` → RabbitMQ → sandbox_helper + sandbox_netblock → DB writeback.
- Image self-check: `sandbox` uid 1002, netblock executable, SB_* limits, fail-closed when netblock missing (`refuse to judge`).
- Not a multi-tenant / gVisor proof.
