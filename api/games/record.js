// POST /api/games/record
// Called by the game host when a game finishes. Stores one game row plus a
// per-player result row. No secret required (low-stakes write); payload is
// validated and capped. Reads the DB connection from env GAMES_DATABASE_URL.
import { neon } from '@neondatabase/serverless';

const POINTS_FOR_PLACE = [3, 2, 1, 0]; // 1st, 2nd, 3rd, 4th+

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!process.env.GAMES_DATABASE_URL) {
    res.status(500).json({ error: 'Server not configured (GAMES_DATABASE_URL missing)' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const gameType = String(body.gameType || 'thirteen').slice(0, 32);
    const room = body.room ? String(body.room).slice(0, 64) : null;
    const players = Array.isArray(body.players) ? body.players.map(p => String(p).slice(0, 48)) : [];
    const placements = Array.isArray(body.placements) ? body.placements.map(p => String(p).slice(0, 48)) : [];
    const scores = (body.scores && typeof body.scores === 'object') ? body.scores : {};
    const roundHistory = Array.isArray(body.roundHistory) ? body.roundHistory.slice(0, 200) : [];
    const ts = body.ts ? new Date(body.ts) : new Date();

    if (placements.length < 2 || placements.length > 8) {
      res.status(400).json({ error: 'placements must list 2–8 players' });
      return;
    }

    const sql = neon(process.env.GAMES_DATABASE_URL);
    const winner = placements[0] || null;
    const loser = placements[placements.length - 1] || null;
    const details = { players, placements, scores, roundHistory };

    const rows = await sql`
      INSERT INTO arcade_games (game_type, room, played_at, num_players, winner, loser, details)
      VALUES (${gameType}, ${room}, ${ts.toISOString()}, ${placements.length}, ${winner}, ${loser}, ${JSON.stringify(details)})
      RETURNING id`;
    const gameId = rows[0].id;

    for (let i = 0; i < placements.length; i++) {
      const pts = POINTS_FOR_PLACE[i] != null ? POINTS_FOR_PLACE[i] : 0;
      await sql`
        INSERT INTO arcade_results (game_id, game_type, player, placement, points, played_at)
        VALUES (${gameId}, ${gameType}, ${placements[i]}, ${i + 1}, ${pts}, ${ts.toISOString()})`;
    }

    res.status(200).json({ ok: true, gameId });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
