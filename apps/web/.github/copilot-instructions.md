# Copilot Instructions — Node/JS

- Follow PROJECT_RULES.md.
- Use JSDoc for all exported/public APIs.
- Validate request payloads and environment variables.
- Use async/await.
- Add/update tests for new logic.
- Do not introduce secrets; use env vars and config schema.

- For database writes, enforce ACID-compliant transactions and avoid partial writes.
- Prefer idempotent write operations when retries are possible.
