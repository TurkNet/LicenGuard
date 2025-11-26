# LicenGuard Python API

FastAPI-based backend that stores OSS libraries and their license metadata (version by version) in MongoDB using an MVC-inspired structure.

## Structure

```
backend/
  app/
    models/          # Pydantic models (M in MVC)
    controllers/     # Business logic + DB operations (C)
    views/           # FastAPI routers (V)
    main.py          # FastAPI application entry
  requirements.txt
  seed.py            # Sample data loader
```

## Getting started

1. Create a virtualenv and install deps (see the notes below for what each dependency provides):
   ```bash
   cd backend
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cp .env.example .env
   ```
2. Start MongoDB locally (default URI `mongodb://localhost:27017`).
3. Seed sample data (optional):
   ```bash
   python seed.py
   ```
4. Launch the API:
   ```bash
   uvicorn app.main:app --reload --port 4000
   ```

### Dependencies in `requirements.txt`

- `fastapi` – web framework + routing/views.
- `uvicorn[standard]` – ASGI server with hot reload support.
- `motor` / `pymongo` – async MongoDB driver and core client.
- `python-dotenv` – loads `backend/.env` so you can keep credentials outside the repo.
- `pydantic` – data validation + schema generation for the MVC models.

Install them once per machine/venv via `pip install -r requirements.txt`.

## Docker workflow

Prefer containers? The backend folder ships with a `Dockerfile` plus `docker-compose.yml` that start both FastAPI and MongoDB:

```bash
cd backend
cp .env.example .env
# when using docker-compose the URI should point at the mongo service:
# MONGODB_URI=mongodb://mongo:27017/licenguard
docker compose up --build
```

This builds the API image (installing `requirements.txt` inside the container), launches MongoDB (`mongo` service) and publishes the API on `http://localhost:4000`. Data is persisted in the named `mongo-data` volume. Stop everything with `docker compose down` (add `-v` to drop the volume).

## Key endpoints

- `GET /health` – liveness probe.
- `GET /libraries` – list libraries with versions.
- `POST /libraries` – create a library entry.
- `GET /libraries/{libraryId}` – fetch a single library.
- `PATCH /libraries/{libraryId}` – update metadata.
- `POST /libraries/{libraryId}/versions` – append a version + license info.
- `GET /libraries/search?q=` – search by name; falls back to the MCP HTTP server to discover new libraries when Mongo has no match.
- `POST /libraries/repositories/scan` – clone a repo, detect dependency files, and run MCP file analysis over each.
- `POST /libraries/repositories/scan/highest-risk` – same scan flow as above but returns `highest_risk_libraries` (sorted by max `risk_score`) for CI/CD gating; payload: `{"url": "<git repo url>"}`.

All responses are JSON and include Mongo `_id` as `id` strings for easy consumption by the React UI and MCP server.
