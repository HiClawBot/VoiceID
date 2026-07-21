# Online Beta environment contract

The application has three intended deployment classes: `development`, `staging`, and `production`. This directory deliberately contains no provider-specific infrastructure or credentials yet.

Every deployed environment must supply:

- `DATABASE_URL` or `DATABASE_URL_FILE`: a managed PostgreSQL connection whose region and retention policy are approved for that environment. Deployed URLs must use `sslmode=verify-full`.
- `EXPECTED_ORIGIN`: the exact browser origin, including scheme and port when present, without a trailing slash.
- `RP_ID`: the WebAuthn relying-party ID covered by `EXPECTED_ORIGIN`.
- `RP_NAME`: the relying-party label shown by authenticators.
- `TOKEN_PEPPER` or `TOKEN_PEPPER_FILE`: at least 32 random characters from the environment secret manager; never shared between environments.
- `DATA_REGION`: the approved managed-PostgreSQL region, matching the invitation and privacy boundary.
- `TRUST_PROXY`: an explicit edge proxy address or CIDR. Trust-all values are rejected.
- `COOKIE_SECURE=true` outside local HTTP development.

When a direct value and its `_FILE` variant are both present, startup fails. The staging Compose contract mounts the database URL and pepper as files rather than exposing them through image configuration.

Deployed startup rejects loopback databases, database connections without full TLS hostname verification, `localhost`, non-HTTPS origins, trust-all proxies, missing data region, the documented development pepper, `COOKIE_SECURE=false`, and `DEV_INVITE_CODE`. See `docs/ONLINE_BETA_STAGING_RUNBOOK.md` for build, smoke, invitation, rollback, backup, alert, and remaining No-Go evidence.
