/**
 * Reset one admin user's password.
 *
 * Run it inside the Railway container, where DATABASE_URL resolves:
 *
 *   railway ssh --service tenyearsproductionlaos -- \
 *     node scripts/reset-admin-password.mjs '<email>' '<new password>'
 *
 * It only ever touches the password_hash of the one account you name, and
 * refuses if that email isn't already a user — so a typo can't quietly create
 * a second admin. Nothing else in the database is read or written.
 */
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: node scripts/reset-admin-password.mjs '<email>' '<new password>'");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Refusing: password must be at least 8 characters.");
  process.exit(1);
}
if (!pool) {
  console.error("Refusing: no DATABASE_URL in this environment.");
  process.exit(1);
}

const target = email.toLowerCase().trim();

const { rows } = await pool.query("SELECT id, email, name, role FROM users WHERE lower(email)=$1", [
  target,
]);

if (!rows.length) {
  const { rows: all } = await pool.query("SELECT email FROM users ORDER BY id");
  console.error(`No user with email "${target}". Existing accounts:`);
  for (const u of all) console.error("  •", u.email);
  await pool.end();
  process.exit(1);
}

const user = rows[0];
const hash = await bcrypt.hash(password, 10);
await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, user.id]);

// Prove the new password actually verifies before declaring success.
const { rows: check } = await pool.query("SELECT password_hash FROM users WHERE id=$1", [user.id]);
const ok = await bcrypt.compare(password, check[0].password_hash);

console.log(ok ? "✓ Password updated and verified" : "✗ Update did not verify — password unchanged?");
console.log(`  account: ${user.email} (${user.name}, role ${user.role})`);
console.log("  log in at /admin/login");

await pool.end();
process.exit(ok ? 0 : 1);
