# Project Rules — Python / FastAPI

## Goals
- Clean, typed Python; predictable APIs; safe dependency management.

## Engineering Best Practices
- **Design:** Apply SOLID where applicable; prefer composition over inheritance; keep responsibilities small.
- **Public API documentation (Tooltip-friendly):** Public modules, classes, and functions MUST include
  docstrings that work well in IDE tooltips.
  - Include: 1-line summary, Args/Returns/Raises (as applicable), and important edge cases.
- **Data integrity (ACID / DB writes):** If the project performs database writes,
  multi-step writes MUST use explicit transactions with clear commit/rollback boundaries.

## See also
- Python docstring templates: ../../shared/doc-templates/python-docstrings.md
- ACID violation checklist (DB writes): ../../shared/acid-violation-checklist.md
- Copilot self-correction prompt: ../../shared/copilot-self-correction-prompt.md

## Style & Tooling
- Use type hints broadly; keep code mypy/pyright-friendly.
- Lint with ruff; format with black (or ruff-format if the repo uses it).
- Avoid mutable default args.

## FastAPI Practices
- Use Pydantic models for request/response.
- Keep routers thin; business logic in services.
- Use `Depends()` for auth/db/config injection.
- Consistent error schema; no leaking internal exceptions.

## Structure
- routers/, schemas/, services/, repositories/, core/

## Security
- Secrets via env/secret manager only.
- Strict CORS.
- Enforce authz per route.

## Testing
- pytest.
- Test routers with TestClient; mock external deps.
