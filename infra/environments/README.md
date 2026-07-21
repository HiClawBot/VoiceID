# Online Beta environment contract

The application has three intended deployment classes: `development`, `staging`, and `production`. This directory deliberately contains no provider-specific infrastructure or credentials yet.

Every deployed environment must supply:

- `DATABASE_URL`: a PostgreSQL connection whose region and retention policy are approved for that environment.
- `EXPECTED_ORIGIN`: the exact browser origin, including scheme and port when present, without a trailing slash.
- `RP_ID`: the WebAuthn relying-party ID covered by `EXPECTED_ORIGIN`.
- `RP_NAME`: the relying-party label shown by authenticators.
- `TOKEN_PEPPER`: at least 32 characters from the environment secret manager; never shared between environments.
- `COOKIE_SECURE=true` outside local HTTP development.

Production startup rejects `localhost`, non-HTTPS origins, the documented development pepper, `COOKIE_SECURE=false`, and `DEV_INVITE_CODE`. Production deployment remains a No-Go until the domain/RP ID, data region, invitation geography, retention, backup, and rollback decisions are approved.
