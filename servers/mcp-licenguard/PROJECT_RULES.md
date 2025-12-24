# Project Rules — Node.js / JavaScript

## Goals
- Production-grade JavaScript, predictable runtime behavior.

## Engineering Best Practices
- **Design:** Apply SOLID where applicable; prefer composition over inheritance; keep responsibilities small.
- **Public API documentation (Tooltip-friendly):** All exported/public APIs MUST include JSDoc (`/** ... */`)
  so code completion tooltips clearly explain intent.
  - Include: 1-line summary, `@param` descriptions, `@returns` / `@throws`, and important edge cases.
- **Data integrity (ACID / DB writes):** If the project performs database writes,
  multi-step writes MUST run inside explicit transactions with commit/rollback semantics.

## See also
- JSDoc templates (TS/JS): ../../shared/doc-templates/jsdoc.md
- ACID violation checklist (DB writes): ../../shared/acid-violation-checklist.md
- Copilot self-correction prompt: ../../shared/copilot-self-correction-prompt.md

## Language & Runtime
- Use JavaScript.
- Prefer a single module system consistently (ESM or CJS; match repo).
- Use Node LTS per repo configuration.

## Style
- Prefer `async/await`.
- Use JSDoc for types and complex shapes when helpful.
- No `console.log` in production paths; use a logger abstraction.

## Structure
- Keep layers separated: routes/controllers, services, repositories, domain, utils.
- Controllers must not contain DB logic; call services.

## Validation & Errors
- Validate external inputs (HTTP, queue, env) with a schema library (zod/yup/etc).
- Centralized error handling; consistent error response shape.
- Do not leak internal stack traces.

## Security
- Never commit secrets.
- Avoid `eval` and shell injection risks; sanitize paths and commands.

## Testing
- Add tests (vitest/jest) for non-trivial logic.
- Mock external integrations (DB/HTTP).
