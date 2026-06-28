/* Minimal migration runner: applies db/migrations/*.sql in name order, then
 * optionally db/seed.sql when called with `node scripts/migrate.js --seed`.
 * No migration-state table yet — files are written to be re-runnable only on a
 * fresh DB. Swap for a real tool (node-pg-migrate, Flyway) before production. */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
require("dotenv/config");

async function run() {
  const url = process.env.DATABASE_URL || "";
  const useSSL = process.env.PGSSL === "true" || /sslmode=require/i.test(url);
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const dir = path.join(__dirname, "..", "db", "migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      process.stdout.write(`Applying ${f} ... `);
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      console.log("ok");
    }
    if (process.argv.includes("--seed")) {
      process.stdout.write("Applying seed.sql ... ");
      await client.query(fs.readFileSync(path.join(__dirname, "..", "db", "seed.sql"), "utf8"));
      console.log("ok");
    }
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
