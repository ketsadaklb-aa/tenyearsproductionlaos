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

    CREATE TABLE IF NOT EXISTS av_projects (
      id SERIAL PRIMARY KEY,
      photo_url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS av_brands (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      logo_url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      visible BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE av_brands ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS catalogue_hidden (
      model_name TEXT PRIMARY KEY,
      hidden_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

  // Seed the brand strip with manufacturers that actually appear in our own
  // inventory, so the section is populated before any logo is uploaded. Names
  // only — logo files are trademarked and get added deliberately in the admin.
  const { rows: brandSeeded } = await pool.query(
    "SELECT value FROM settings WHERE key='av_brands_seeded'"
  );
  if (!brandSeeded.length) {
    // Logo files supplied by the business. Each carries what it is actually
    // used for, so the strip reads as a capability list rather than a wall of
    const brands = [
      ["Shure", "shure", "Microphones & wireless"],
      ["Sennheiser", "sennheiser", "Microphones & wireless"],
      ["AKG", "akg", "Microphones"],
      ["JBL", "jbl", "Loudspeakers"],
      ["d&b audiotechnik", "dandb-audiotechnik", "Loudspeakers"],
      ["Electro-Voice", "electro-voice", "Loudspeakers"],
      ["dBTechnologies", "dbtechnologies", "Loudspeakers"],
      ["Soundvision", "soundvision", "Line array & install speakers"],
      ["SoundWork", "soundwork", "Line array & install speakers"],
      ["DiGiCo", "digico", "Digital mixing"],
      ["Midas", "midas", "Digital mixing"],
      ["Yamaha", "yamaha", "Mixing & installed audio"],
      ["Behringer", "behringer", "Mixing & amplification"],
      ["dbx", "dbx", "Signal processing"],
      ["Bosch", "bosch", "Conference & paging"],
      ["VShow", "", "Stage & effect lighting"],
      ["CM", "cm", "Cable & connectors"],
    ];
    let bi = 0;
    for (const [name, slug, category] of brands) {
      await pool.query(
        "INSERT INTO av_brands (name, logo_url, category, sort_order) VALUES ($1,$2,$3,$4)",
        [name, slug ? `/assets/brands/${slug}.png` : "", category, bi++]
      );
    }
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('av_brands_seeded','1') ON CONFLICT (key) DO NOTHING"
    );
    console.log(`✓ Seeded ${brands.length} AV brands`);
  }

  // Seed the installation photos supplied for the AV Solutions page. Guarded by
  // a settings key rather than a row count, so clearing the section out from the
  // admin doesn't make them reappear on the next boot.
  const { rows: avSeeded } = await pool.query(
    "SELECT value FROM settings WHERE key='av_projects_seeded'"
  );
  if (!avSeeded.length) {
    const seed = [
      ["/assets/av/hall-led-wall.jpg", "Main hall LED wall with flanking displays",
       "Centre wall plus two side screens, installed for a conference hall in Vientiane."],
      ["/assets/av/install-ceremony-hall.jpg", "Indoor LED wall, ceremony hall",
       "Large-format indoor wall installed for state ceremonies, Vientiane."],
      ["/assets/av/install-draw-hall.jpg", "Broadcast draw hall",
       "Stage LED wall and side monitors for a live televised draw, Vientiane."],
      ["/assets/av/install-commissioning.jpg", "Panel alignment during commissioning",
       "Our engineer aligning modules on an installed indoor wall before handover."],
      ["/assets/av/install-moic-p3.jpg", "Ministry of Industry and Commerce",
       "Indoor P3 fine-pitch LED wall, Vientiane."],
      ["/assets/av/install-edl-lobby.jpg", "EDL — Électricité du Laos",
       "Front-of-house LED display in the head office lobby, Vientiane."],
      ["/assets/av/install-mfa-conference.jpg", "Ministry of Foreign Affairs",
       "Soundvision delegate conference system in the main hall, Vientiane."],
    ];
    let i = 0;
    for (const [url, title, detail] of seed) {
      await pool.query(
        "INSERT INTO av_projects (photo_url, title, detail, sort_order) VALUES ($1,$2,$3,$4)",
        [url, title, detail, i++]
      );
    }
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('av_projects_seeded','1') ON CONFLICT (key) DO NOTHING"
    );
    console.log(`✓ Seeded ${seed.length} AV installation projects`);
  }

  // Carry over the one model that used to be hidden in code, so the live page
  // keeps looking the same and the choice becomes editable in /admin/catalogue.
  const { rows: seeded } = await pool.query(
    "SELECT value FROM settings WHERE key='catalogue_hidden_seeded'"
  );
  if (!seeded.length) {
    await pool.query(
      "INSERT INTO catalogue_hidden (model_name) VALUES ('Shure SM58 (Wireless)') ON CONFLICT DO NOTHING"
    );
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ('catalogue_hidden_seeded','1') ON CONFLICT (key) DO NOTHING"
    );
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

// ---- AV Solutions installation projects ----
export async function getAvProjects({ all = false } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM av_projects ${all ? "" : "WHERE visible = true"}
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

// ---- AV Solutions brands ----
// A brand may have no logo file yet; the page falls back to a wordmark, so the
// strip looks intentional before anyone uploads anything.
export async function getAvBrands({ all = false } = {}) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT * FROM av_brands ${all ? "" : "WHERE visible = true"}
     ORDER BY sort_order ASC, id ASC`
  );
  return rows;
}

// ---- equipment catalogue visibility ----
// One row per ERP model name we do NOT want on the public equipment page.
// The gear stays fully active in the ERP; this only controls the website.
export async function getHiddenModels() {
  if (!pool) return new Set();
  const { rows } = await pool.query("SELECT model_name FROM catalogue_hidden");
  return new Set(rows.map((r) => r.model_name.toLowerCase()));
}
export async function setModelHidden(modelName, hidden) {
  if (!pool) return;
  if (hidden) {
    await pool.query(
      "INSERT INTO catalogue_hidden (model_name) VALUES ($1) ON CONFLICT DO NOTHING",
      [modelName]
    );
  } else {
    await pool.query("DELETE FROM catalogue_hidden WHERE lower(model_name)=lower($1)", [modelName]);
  }
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
