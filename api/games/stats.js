// POST /api/games/stats   body: { password }
// Returns the leaderboard + recent games, but only when the admin password
// matches env ARCADE_ADMIN_PASSWORD. DB connection from env GAMES_DATABASE_URL.
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!process.env.GAMES_DATABASE_URL || !process.env.ARCADE_ADMIN_PASSWORD) {
    res.status(500).json({ error: 'Server not configured (missing env vars)' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const password = String(body.password || '');
    if (password !== process.env.ARCADE_ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Wrong password' });
      return;
    }

    const sql = neon(process.env.GAMES_DATABASE_URL);

    const leaderboard = await sql`
      SELECT r.player,
             COUNT(*)::int                                      AS games,
             SUM((r.placement = 1)::int)::int                   AS wins,
             SUM((r.placement = 2)::int)::int                   AS seconds,
             SUM((r.placement = 3)::int)::int                   AS thirds,
             SUM((r.placement = g.num_players)::int)::int       AS lasts,
             SUM(r.points)::int                                 AS points,
             MAX(r.played_at)                                   AS last_played
      FROM arcade_results r
      JOIN arcade_games g ON g.id = r.game_id
      GROUP BY r.player
      ORDER BY wins DESC, points DESC, games DESC`;

    const recent = await sql`
      SELECT id, game_type, room, played_at, num_players, winner, loser, details
      FROM arcade_games
      ORDER BY played_at DESC
      LIMIT 100`;

    const totals = await sql`
      SELECT COUNT(*)::int AS total_games,
             COUNT(DISTINCT r.player)::int AS total_players
      FROM arcade_games g
      LEFT JOIN arcade_results r ON r.game_id = g.id`;

    res.status(200).json({ ok: true, leaderboard, recent, totals: totals[0] || {} });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
