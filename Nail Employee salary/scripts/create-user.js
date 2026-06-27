/* Set (or rotate) a staff member's login password.
 *
 *   node scripts/create-user.js owner@polished.test "s3cret-pass"
 *
 * The email must match an existing staff row (see db/seed.sql). Hashes with
 * bcrypt and upserts into staff_credentials. */
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
require("dotenv/config");

async function run() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: node scripts/create-user.js <email> "<password>"');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, full_name, role FROM staff WHERE email = $1 AND is_active`,
      [email]
    );
    if (rows.length === 0) throw new Error(`No active staff with email ${email}`);
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO staff_credentials (staff_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (staff_id)
       DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
      [rows[0].id, hash]
    );
    console.log(`Password set for ${rows[0].full_name} (${rows[0].role}) <${email}>`);
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
