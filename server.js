import express from "express";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Railway injects PORT. Fall back to 3000 locally.
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Database (Postgres) — provided by Railway as DATABASE_URL.
// Runs fine without a DB locally: submissions are logged instead of stored.
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || "";
const useSSL =
  DB_URL && !DB_URL.includes("railway.internal") && !DB_URL.includes("localhost");
const pool = DB_URL
  ? new Pool({
      connectionString: DB_URL,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
    })
  : null;

async function initDb() {
  if (!pool) {
    console.warn("⚠  No DATABASE_URL set — contact submissions will be logged, not stored.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id         SERIAL PRIMARY KEY,
      name       TEXT,
      email      TEXT,
      subject    TEXT,
      message    TEXT,
      payload    JSONB,
      source     TEXT,
      ip         TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log("✓ Postgres connected, 'contacts' table ready.");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.set("trust proxy", true);
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// ---------------------------------------------------------------------------
// API: receive a contact-form submission and store it.
// ---------------------------------------------------------------------------
app.post("/api/contact", async (req, res) => {
  const b = req.body || {};

  // Honeypot: real users leave "website" empty. Bots fill it. Silently accept.
  if (b.website) return res.json({ ok: true });

  const name = (b.name || "").toString().trim();
  const email = (b.email || "").toString().trim();
  const subject = (b.subject || "").toString().trim();
  const message = (b.message || "").toString().trim();
  const source = (b.source || "contact").toString().slice(0, 60);

  if (!email && !message && !name) {
    return res.status(400).json({ ok: false, error: "Empty submission." });
  }

  if (!pool) {
    console.log("📨 Contact (not stored — no DB):", { name, email, subject, message });
    return res.json({ ok: true, stored: false });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, email, subject, message, payload, source, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, email, subject, message, JSON.stringify(b), source, req.ip]
    );
    console.log(`✓ Saved contact #${rows[0].id} from ${email || name}`);
    res.json({ ok: true, stored: true, id: rows[0].id });
  } catch (err) {
    console.error("DB insert failed:", err.message);
    res.status(500).json({ ok: false, error: "Could not save your message." });
  }
});

// ---------------------------------------------------------------------------
// Admin: view stored submissions. Protected by HTTP Basic Auth.
// Set ADMIN_USER / ADMIN_PASS in Railway variables.
// ---------------------------------------------------------------------------
function basicAuth(req, res, next) {
  const user = process.env.ADMIN_USER || "admin";
  const pass = process.env.ADMIN_PASS || "changeme";
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [u, p] = Buffer.from(encoded, "base64").toString().split(":");
    if (u === user && p === pass) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Ten Years Admin"');
  res.status(401).send("Authentication required.");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

app.get("/admin/contacts", basicAuth, async (req, res) => {
  if (!pool) return res.send("<p>No database connected.</p>");
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, subject, message, source, created_at FROM contacts ORDER BY id DESC LIMIT 500"
    );
    const trs = rows
      .map(
        (r) => `<tr>
          <td>${r.id}</td>
          <td>${esc(new Date(r.created_at).toLocaleString())}</td>
          <td>${esc(r.name)}</td>
          <td><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
          <td>${esc(r.subject)}</td>
          <td>${esc(r.message)}</td>
        </tr>`
      )
      .join("");
    res.send(`<!doctype html><html><head><meta charset="utf-8">
      <title>Contacts — Ten Years Production</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;background:#0e0e10;color:#eee}
        h1{font-size:1.4rem} table{border-collapse:collapse;width:100%;font-size:.9rem}
        th,td{border:1px solid #2a2a30;padding:.5rem .6rem;text-align:left;vertical-align:top}
        th{background:#1a1a1f} tr:nth-child(even){background:#141418}
        a{color:#e2b04a}
      </style></head><body>
      <h1>Contact submissions (${rows.length})</h1>
      <table><thead><tr>
        <th>#</th><th>When</th><th>Name</th><th>Email</th><th>Subject</th><th>Message</th>
      </tr></thead><tbody>${trs || '<tr><td colspan="6">No submissions yet.</td></tr>'}</tbody></table>
      </body></html>`);
  } catch (err) {
    res.status(500).send("Error: " + esc(err.message));
  }
});

// Optional JSON export of all submissions (same auth).
app.get("/admin/contacts.json", basicAuth, async (req, res) => {
  if (!pool) return res.json([]);
  const { rows } = await pool.query("SELECT * FROM contacts ORDER BY id DESC");
  res.json(rows);
});

// ---------------------------------------------------------------------------
// Static site (the mirrored pages + assets).
// ---------------------------------------------------------------------------
app.use(express.static(join(__dirname, "public")));

// ---------------------------------------------------------------------------
initDb()
  .catch((e) => console.error("initDb error:", e.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Ten Years Production Laos running on http://localhost:${PORT}`);
    });
  });
