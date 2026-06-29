# Restaurant POS API — Deploy

A quick-service Restaurant POS API (menu, orders, kitchen display, payments).
Same architecture as the salon API: Node + TypeScript + Express + Postgres,
deployed as a Vercel serverless function reading a Neon database.

## ⚠️ Use a SEPARATE database from the salon

This service uses generic table names (`staff`, `staff_credentials`, `payments`,
`audit_log`) and a `staff_role` enum — the **same names** the salon API uses.
If you point both APIs at the *same* database, the setup script will collide.

So: create a **new database** for the restaurant. In Neon you can either
- add a new database inside your existing project (Dashboard → Databases → New), or
- create a new Neon project.

Either way, copy that database's connection string for `DATABASE_URL`.

## 1. Create the schema

Open the Neon SQL editor for the **restaurant** database and run the whole of
`db/neon-setup.sql`. It creates every table plus a demo restaurant
(`Bayou Brew`) with a small menu and an owner login `owner@bayoubrew.test`.

To set the demo owner's password, run (bottom of that file):

```sql
UPDATE staff_credentials SET password_hash = crypt('your_password', gen_salt('bf',10))
  WHERE staff_id = '00000000-0000-0000-0000-0000000000b0';
```

Or skip the demo entirely and use **Create restaurant** in the app to make your own.

## 2. Deploy on Vercel

Create a **new Vercel project** whose **Root Directory** is `restaurant-server`.
It auto-detects `vercel.json` (serverless function at `api/index.ts`).

Environment variables:

| Name           | Value                                                        |
|----------------|-------------------------------------------------------------|
| `DATABASE_URL` | the **restaurant** Neon pooled connection string (`-pooler`)|
| `JWT_SECRET`   | any long random string                                      |
| `CORS_ORIGIN`  | your site origin, e.g. `https://www.thehoustonitsolutions.com` (optional; defaults to reflecting the request origin) |
| `PGSSL`        | `true` (if your connection string lacks `sslmode=require`)  |

Deploy, then note the function URL, e.g. `https://restaurant-pos-api.vercel.app`.

## 3. Point the app at the API

In `restaurant.html` (repo root) the API base is set near the top:

```html
<script>window.__RESTO_API__ = "https://restaurant-pos-api.vercel.app";</script>
```

Set it to your deployed URL, commit, and push. The POS hub
(`pos-solutions.html`) and detail page (`restaurant-pos.html`) already link to
`restaurant.html`.

## Endpoints (summary)

- `POST /auth/register-restaurant` · `POST /auth/login` · `GET /auth/me`
- `GET /restaurants/:id/menu` · `POST /menu/categories` · `POST /menu/items` · `PATCH /menu/items/:id`
- `GET/PUT /restaurants/:id/settings`
- `GET /restaurants/:id/staff` · `POST /staff` · `POST /staff/:id/credential`
- `POST /orders` · `GET /orders?status=...` · `POST /orders/:id/ready` · `POST /orders/:id/checkout`
- `POST /order-items/:id/bump`
- `GET /reports/sales?since=ISO`

## Local dev

```bash
npm install
DATABASE_URL=... JWT_SECRET=dev npm run dev   # http://localhost:4100
npm test                                       # order-engine unit checks
```
