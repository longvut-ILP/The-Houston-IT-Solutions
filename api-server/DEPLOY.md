# Deploying the Nail Salon POS

Two pieces deploy separately:

- **Frontend** (your website + the POS demo) → **Vercel** (already where your site lives).
- **Backend API** → a **Vercel serverless function** (same GitHub repo, a 2nd Vercel project).
- **Database** → **Vercel Postgres (Neon)**.

Everything ends up on Vercel from one GitHub repo.

The demo (`pos.html`) needs none of this — it runs in the browser. The steps below
are for the *real* app with logins and saved data.

---

## Part 1 — Go live with the site (no backend)

Push these to the GitHub repo Vercel builds from, and it auto-deploys:

```
index.html  pos-solutions.html  salon-pos.html  pos.css  pos.html  app.html
```

```bash
git add index.html pos-solutions.html salon-pos.html pos.css pos.html app.html
git commit -m "Add POS product pages + demo"
git push
```

That's the whole public site live, including a working demo.

---

## Part 2 — Database (Vercel Postgres / Neon)

1. Vercel dashboard → **Storage → Create Database → Postgres** (powered by Neon).
   Choose a **region near where the API will run** (your Railway/Render region).
2. Open the store → **`.env.local`** tab. It shows several variables. You care about two:
   - **`POSTGRES_URL`** — *pooled* (PgBouncer). For the running app.
   - **`POSTGRES_URL_NON_POOLING`** — *direct*. For migrations.

> Two strings, two jobs:
> - **Migrations** (run once from your machine) → use the **direct**
>   `POSTGRES_URL_NON_POOLING`. PgBouncer can choke on DDL/transactions.
> - **The serverless API** → use the **pooled** `POSTGRES_URL`. Serverless spins
>   up many short-lived instances, so connection pooling is required.

Both URLs already include `sslmode=require`, so the code enables TLS automatically
(or set `PGSSL=true`). For serverless, set `PG_POOL_MAX=1` so each warm function
instance holds at most one DB connection (PgBouncer multiplexes the rest).

### Run migrations + seed (one time)

From your machine, using the **direct** (`NON_POOLING`) URL:

```bash
cd api-server
npm install
export DATABASE_URL="<POSTGRES_URL_NON_POOLING>"   # the direct string
PGSSL=true npm run migrate -- --seed
PGSSL=true npm run create-user owner@yoursalon.com "a-strong-password"
```

This creates all tables and an owner login. (Re-running migrations is only safe on a
fresh DB — there's no migration-state table yet.)

---

## Part 3 — Deploy the API on Vercel (serverless)

The repo includes `api/index.ts` (exports the Express app) and `vercel.json`
(routes every path to it). Add the API as a **second Vercel project** from the
same GitHub repo — your website is the first project.

1. Vercel → **Add New… → Project** → import the same GitHub repo.
2. **Root Directory** = `api-server` (the API folder). Framework preset: **Other**.
3. Add the environment variables (below).
4. **Deploy.** Vercel reads `vercel.json` + `api/index.ts` and serves the Express
   app at every path.

You'll get an API URL like `https://salon-pos-api.vercel.app`.
Check it: open `https://<api-url>/health` → `{"ok":true}`.

### Environment variables (API Vercel project)

| Var | Value |
| --- | ----- |
| `DATABASE_URL` | Vercel Postgres **pooled** URL (`POSTGRES_URL`) |
| `PGSSL` | `true` |
| `PG_POOL_MAX` | `1` |
| `JWT_SECRET` | a long random string (`openssl rand -hex 32`) |
| `JWT_EXPIRES_IN` | `12h` |
| `CORS_ORIGIN` | your site origin, e.g. `https://yourdomain.com` |
| `PAYMENT_PROVIDER` | `mock` (until Stripe is set up) |

> Serverless trade-offs: a cold start (~1s) after idle, compounded with Neon's
> autosuspend — fine for low traffic. When you later enable Stripe, the webhook
> needs the **raw** request body; verify `/webhooks/stripe` after switching off mock.
>
> Want a persistent server instead? The repo also has a `Dockerfile` — deploy on
> Railway/Render and use the **direct** (`NON_POOLING`) DB URL + `PG_POOL_MAX=10`.

---

## Part 4 — Point the frontend at the API

The real app reads its API base from `window.__SALON_API__` (falls back to
`http://localhost:4000`). The real app is **`app.html`** (already at your site root). Open it and set the
API base near the top of the file — it has one clearly-marked line:

```html
<script>window.__SALON_API__ = "https://<your-api-url>";</script>
```

Then `CORS_ORIGIN` on the API must equal the site origin serving that page.

---

## Checklist

- [ ] Site pushed to GitHub → Vercel live (Part 1)
- [ ] Vercel Postgres created; pooled + direct URLs in hand (Part 2)
- [ ] Migrated + seeded over the **direct** URL; owner login created (Part 2)
- [ ] API = 2nd Vercel project (root `api-server`), env vars set, `/health` ok (Part 3)
- [ ] `CORS_ORIGIN` = your site; `window.__SALON_API__` in `app.html` = API URL (Part 4)
- [ ] (Later) Stripe keys + webhook for real payouts — see API_README.md
