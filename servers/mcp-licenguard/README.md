# LicenGuard MCP server

Expose LicenGuard data to MCP-compatible agents. Requires the Python API running locally.

```bash
cd servers/mcp-licenguard
npm install
API_URL=http://localhost:4000 OPENAI_API_KEY=sk-... npm run dev
```

Tools:
- `list-libraries` – returns the entire library catalog.
- `library-detail` – fetches a single library by id.
- `discover-library-info` – uses ChatGPT (OpenAI) to find GitHub/homepage URLs, versions, and license info for a library. Configure `OPENAI_API_KEY`, optionally `OPENAI_MODEL` / `OPENAI_API_URL`.

### Using a local LLM

If you have an on-prem LLM endpoint, set `LOCAL_LLM_API_URL` and `LOCAL_LLM_API_KEY` in `.env` (optionally `LOCAL_LLM_MODEL`). When these are present, discovery requests are routed to the local endpoint; otherwise the server falls back to OpenAI. For local usage the defaults are `X-API-Key` (no prefix) and a helper header `X-Request-Source: post_text_script`. You can override via:

- `LOCAL_LLM_AUTH_HEADER` (default `X-API-Key`, use e.g. `Authorization`)
- `LOCAL_LLM_AUTH_PREFIX` (default empty for locals; set `Bearer`/`Token` etc.)
- `LOCAL_LLM_EXTRA_HEADERS` (JSON object string) to inject additional headers, e.g. `{"X-Request-Source":"post_text_script"}`

## License risk scoring

During discovery, the MCP server calculates a simple license risk:

- It scans `license`, `licenseSummary` text/emojis.
- Strong copyleft keywords or 🔴/🚫 emojis ⇒ `risk_level = high`, base score 90.
- Weak copyleft keywords or 🟠/🟡 ⇒ `risk_level = medium`, base score 60.
- Permissive keywords or 🟢/✅ ⇒ `risk_level = low`, base score 10.
- Falls back to `unknown` with base 50 if nothing matches.
- Final `risk_score` = base * confidence (capped 0–100, rounded).

Both `risk_level` and `risk_score` are persisted on versions and returned in MCP responses. Use these to gate CI/CD (e.g., fail on `risk_level === 'high'` or `risk_score >= threshold`).

### LLM-based detailed risk scoring

In addition to the heuristic above, the MCP server calls the LLM with `scoreLibraryRisk` (`servers/mcp-licenguard/src/services/riskScoring.js`) to produce a richer breakdown:

- Input: the discovered package JSON (name, ecosystem, official site/repo, versions, license summary/evidence, existing risk values).
- Output: `risk_score`/`risk_level` plus sub-scores (`license_risk_score`, `security_risk_score`, `maintenance_risk_score`, `usage_context_risk_score`), `key_factors`, `recommended_actions`, and a `confidence`.
- The returned object is attached to matches as `risk_details` and `risk_score`/`risk_level` are reused for UI/API consumers.

The same LLM config/env vars (`OPENAI_*` or `LOCAL_LLM_*`) are used for both discovery and risk scoring.

## Transports

The server now speaks both STDIO and the Streamable HTTP transport:

- STDIO remains enabled by default for IDE integrations.
- HTTP is also enabled by default and listens on `http://127.0.0.1:3333/mcp`. Point any MCP HTTP client (Claude Desktop, VS Code MCP inspector, etc.) at that URL.

Environment toggles:

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_STDIO_ENABLED` | `true` | Disable (`false`) to skip STDIO startup. |
| `MCP_HTTP_ENABLED` | `true` | Disable (`false`) to skip HTTP transport. |
| `MCP_HTTP_PORT` | `3333` | Listening port for HTTP transport. |
| `MCP_HTTP_HOST` | `127.0.0.1` | Listening address for HTTP transport. |
| `MCP_HTTP_PATH` | `/mcp` | Path guarded by the MCP handler. |
| `MCP_HTTP_ALLOWED_HOSTS` | _unset_ | Optional comma-separated hosts for DNS-rebinding protection. |
| `MCP_HTTP_ALLOWED_ORIGINS` | _unset_ | Optional comma-separated origins for DNS-rebinding protection. |
