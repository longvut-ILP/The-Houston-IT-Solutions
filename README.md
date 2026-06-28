# Houston IT Solutions — Website + Polished POS

This repo holds the marketing site **and** the Salon POS product.

## Structure

```
/                          ← static website (deploy as Vercel project #1)
  index.html               Houston IT Solutions home (nav → POS Systems)
  pos-solutions.html       POS product-line hub (salon live; restaurant/grocery soon)
  salon-pos.html           Salon POS landing page
  pos.html                 Salon POS DEMO (mock data, no backend, works for anyone)
  app.html                 Salon POS REAL app (set window.__SALON_API__ to your API URL)
  pos.css                  shared styles for the POS pages
  custom-builds.html       (your existing page)

api-server/      ← the API (deploy as Vercel project #2, root = this folder)
  api/index.ts             Vercel serverless entry (exports the Express app)
  vercel.json              routes all paths to the function
  src/                     TypeScript API (engine, repos, services, http, auth, payments)
  db/                      SQL migrations, seed, and neon-setup.sql (paste into Neon)
  Dockerfile               alternative: run the API on Railway/Render instead
  DEPLOY.md                ← step-by-step deploy guide (start here)
  API_README.md            API endpoints + design notes
```

## Deploy (summary — full steps in `api-server/DEPLOY.md`)

1. Push this repo to GitHub.
2. **Vercel project #1** = the website (root = repo root). The demo works immediately.
3. **Neon**: create a Vercel Postgres database, run `api-server/db/neon-setup.sql`
   in its SQL Editor (set the owner password first).
4. **Vercel project #2** = the API (root = `api-server`). Set env vars
   (`DATABASE_URL` = pooled Neon URL, `PGSSL=true`, `PG_POOL_MAX=1`, `JWT_SECRET`, `CORS_ORIGIN`).
5. Put the API's URL into `app.html` (`window.__SALON_API__`), push.

## Demo vs real app
- `pos.html` — marketing demo, mock data, no login. Safe to show anyone.
- `app.html` — the real product; logs into your API + Neon database.
