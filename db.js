import pg from "pg";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || "";
const useSSL =
  DB_URL && !DB_URL.includes("railway.internal") && !DB_URL.includes("localhost");

export const pool = DB_URL
  ? new Pool({
      connectionString: DB_URL,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    })
  : null;

export async function initSchema() {
  if (!pool) {
    console.warn("⚠  No DATABASE_URL — admin/back-office disabled.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY, name TEXT, email TEXT, subject TEXT, message TEXT,
      payload JSONB, source TEXT, ip TEXT,
      handled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE contacts ADD COLUMN IF NOT EXISTS handled BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS gallery_photos (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      caption TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      filename TEXT NOT NULL DEFAULT '',
      size_bytes BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await seedIfEmpty();
  console.log("✓ Postgres schema ready.");
}

async function seedIfEmpty() {
  // First admin user
  const { rows: u } = await pool.query("SELECT count(*)::int AS n FROM users");
  if (u[0].n === 0) {
    const email = (process.env.SEED_ADMIN_EMAIL || "ketsadaklb@gmail.com").toLowerCase();
    const pass = process.env.SEED_ADMIN_PASSWORD || process.env.ADMIN_PASS || "changeme";
    const hash = await bcrypt.hash(pass, 10);
    await pool.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1,$2,$3,'admin')",
      [email, "Admin", hash]
    );
    console.log(`✓ Seeded admin user: ${email}`);
  }

  // Gallery + clients from seed-content.json
  const { rows: g } = await pool.query("SELECT count(*)::int AS n FROM gallery_photos");
  if (g[0].n === 0) {
    let seed = { photos: [], clients: [] };
    try {
      seed = JSON.parse(readFileSync(join(__dirname, "seed-content.json"), "utf8"));
    } catch (e) {
      console.warn("seed-content.json not found:", e.message);
    }
    let i = 0;
    for (const p of seed.photos) {
      await pool.query(
        "INSERT INTO gallery_photos (url, caption, sort_order) VALUES ($1,$2,$3)",
        [p.url, p.alt || "", i++]
      );
    }
    let j = 0;
    for (const c of seed.clients) {
      await pool.query(
        "INSERT INTO clients (name, logo_url, sort_order) VALUES ($1,$2,$3)",
        [c.name || "", c.url, j++]
      );
    }
    console.log(`✓ Seeded ${seed.photos.length} photos, ${seed.clients.length} clients`);
  }

  // Default homepage hero video/poster (so they're editable from the back-office)
  await pool.query(
    `INSERT INTO settings (key, value) VALUES
       ('hero_video_url', '/wp-content/uploads/2024/03/Website-3.mp4'),
       ('hero_poster_url', '/wp-content/uploads/2024/03/Website-3-poster.jpg')
     ON CONFLICT (key) DO NOTHING`
  );
}

export async function getSettings() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT key, value FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function setSetting(key, value) {
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2",
    [key, value]
  );
}
export async function getDocuments() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT * FROM documents ORDER BY id DESC");
  return rows;
}

// ---- public content getters ----
export async function getGallery() {
  if (!pool) return [];
  const { rows } = await pool.query(
    "SELECT * FROM gallery_photos WHERE visible = true ORDER BY sort_order ASC, id ASC"
  );
  return rows;
}
export async function getClients() {
  if (!pool) return [];
  const { rows } = await pool.query(
    "SELECT * FROM clients WHERE visible = true ORDER BY sort_order ASC, id ASC"
  );
  return rows;
}
