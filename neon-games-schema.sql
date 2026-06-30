-- ============================================================
-- Arcade game stats — Neon Postgres schema
-- Use a SEPARATE Neon database from the salon and restaurant APIs.
-- Run this once in the Neon SQL editor for the new "games" database.
-- ============================================================

-- One row per completed game (a single hand of Tiến Lên, or a Cờ Tướng match).
CREATE TABLE IF NOT EXISTS arcade_games (
  id           BIGSERIAL PRIMARY KEY,
  game_type    TEXT        NOT NULL DEFAULT 'thirteen',  -- 'thirteen' | 'cotuong'
  room         TEXT,                                     -- e.g. 'ET' or a 4-digit PIN
  played_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  num_players  INT         NOT NULL,
  winner       TEXT,                                     -- 1st-place player
  loser        TEXT,                                     -- last-place player
  details      JSONB                                     -- full payload (placements, scores, history)
);

-- One row per player per game (makes aggregation/leaderboards easy).
CREATE TABLE IF NOT EXISTS arcade_results (
  id         BIGSERIAL PRIMARY KEY,
  game_id    BIGINT      NOT NULL REFERENCES arcade_games(id) ON DELETE CASCADE,
  game_type  TEXT        NOT NULL DEFAULT 'thirteen',
  player     TEXT        NOT NULL,
  placement  INT,                                        -- 1 = winner ... N = last
  points     INT         NOT NULL DEFAULT 0,             -- points earned this game (3/2/1/0)
  played_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_arcade_results_player   ON arcade_results (player);
CREATE INDEX IF NOT EXISTS idx_arcade_results_game     ON arcade_results (game_id);
CREATE INDEX IF NOT EXISTS idx_arcade_games_played_at  ON arcade_games (played_at DESC);
