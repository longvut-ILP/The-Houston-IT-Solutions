# Arcade Player Stats — setup

Game results are recorded to a Neon Postgres database through two Vercel
serverless functions in this repo, and viewed on a password-protected page.

```
/api/games/record.js   ← host POSTs each finished game here (no password)
/api/games/stats.js    ← admin dashboard reads from here (needs password)
/games/stats.html      ← the dashboard (linked from the Arcade footer)
neon-games-schema.sql  ← the database tables
```

## One-time setup

### 1. Create a Neon database
Use a **separate** Neon database from the salon and restaurant APIs (they share
generic table names). In the Neon console create a new database (e.g. `arcade`),
open its SQL editor, and run the contents of `neon-games-schema.sql`.

Copy that database's connection string (the **pooled** one, looks like
`postgresql://user:pass@ep-xxxx-pooler.../arcade?sslmode=require`).

### 2. Add environment variables in Vercel
In the Vercel project for the main site (thehoustonitsolutions.com) →
**Settings → Environment Variables**, add:

| Name                   | Value                                              |
|------------------------|----------------------------------------------------|
| `GAMES_DATABASE_URL`   | the Neon connection string from step 1             |
| `ARCADE_ADMIN_PASSWORD`| a password of your choice for the stats page       |

Add them for the **Production** environment (and Preview if you want).
Do **not** commit these values to the repo.

### 3. Deploy
Commit and push (the new `package.json` tells Vercel to install the database
driver and to build the `/api` functions; the static site keeps serving as
before). Vercel auto-deploys.

## Using it
- Players just play as normal. When a Tiến Lên hand ends, the host's browser
  quietly posts the result.
- Go to the Arcade page → footer → **Player Stats**, or visit
  `/games/stats.html`, enter the admin password, and you'll see the leaderboard
  (games, wins, placements, points, win %) and a recent-games log.

## Notes
- If the API isn't deployed yet, the game still works — the recording call just
  fails silently.
- Cờ Tướng can be added later by POSTing to `/api/games/record` with
  `gameType: 'cotuong'` on match end; the schema and dashboard already support it.
- To change the password, update `ARCADE_ADMIN_PASSWORD` in Vercel and redeploy.
