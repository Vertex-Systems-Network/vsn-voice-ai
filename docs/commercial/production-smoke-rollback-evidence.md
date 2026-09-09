# Production Smoke, Rollback and Recovery Evidence

Status: **real production verification pending**.

`config/release/production-smoke-rollback-evidence.json` separates source certification from proof that the exact certified commercial release is actually deployed and recoverable.

Launch evidence must verify the expected service/protocol/runtime identity, `/api/version`, `/api/ready`, authenticated customer smoke, authenticated operator smoke, rollback procedure, backup restore, and explicit RPO/RTO evidence.

A green source build, a health endpoint, or an older deployment cannot satisfy this gate. `production_ready` remains false until the current certified release is verified in production and recovery evidence exists.
