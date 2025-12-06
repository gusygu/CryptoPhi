# Operations (Dev)

High-level ops guidance without environment secrets.

## Backups & recovery
- **Backups**: Schedule regular logical dumps of the primary database and store them in a secure bucket with retention. Tag backups with environment + timestamp.
- **Recovery drills**: Periodically restore a backup into a staging environment to validate integrity and migration compatibility.
- **Runbooks**: Keep a private runbook (out of git) with exact commands, hosts, and credentials. This doc only captures the flow.

## Deploys
- Ensure env vars (`BASE_URL`, `COOKIE_DOMAIN`, database URL, feature toggles) are set per environment.
- Run migrations before or during deploy with a controlled migration job.
- Post-deploy smoke: health endpoint, `/api/matrices/latest`, invite flow, auth sign-in.

## Monitoring & alerts (describe, don’t expose)
- Track sampler freshness (time since last sample), API error rates, and DB connectivity.
- Alert on invite/auth failures, sampler stalls, and elevated 5xx rates.

## Incident quick-notes
- If samplers restart, expect a short warm-up while buffers refill.
- If auth cookies fail on a new domain, verify `BASE_URL` and `COOKIE_DOMAIN`.
- If matrices return cached data only, check upstream market API availability and ingest queues.
