# Copilot Instructions — Python/FastAPI

- Follow PROJECT_RULES.md.
- Use Pydantic models for all request/response bodies.
- Keep routers thin; put logic into services.
- Use Depends() for db/auth/config.
- Add type hints.
- Add pytest tests for new endpoints and service logic.

- Ensure public functions/classes/modules include clear docstrings visible in code completion tooltips.
- For database writes, enforce ACID-friendly transaction boundaries and avoid partial writes.
