# LicenGuard Web UI

React (Webpack) frontend for browsing libraries and their license data. Talks to the Python API running on port 4000 by default.

## Scripts

```bash
npm install
npm run dev --workspace @licenguard/web
npm run build --workspace @licenguard/web
npm run preview --workspace @licenguard/web
```

- `npm run dev` – starts `webpack-dev-server` on http://localhost:5173.
- `npm run build` – outputs production assets to `apps/web/dist`.
- `npm run preview` – serves the `dist/` folder via `serve` for quick spot checks.

Set `API_URL` before running the scripts if the backend isn't on `http://localhost:4000`, e.g. `API_URL=http://localhost:5000 npm run dev --workspace @licenguard/web`.
