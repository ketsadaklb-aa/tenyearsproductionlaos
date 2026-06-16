import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { pool, initSchema, getGallery, getClients, getSettings } from "./db.js";
import adminRouter, { UPLOAD_DIR } from "./admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = join(__dirname, "public");

// Trust exactly one proxy hop (Railway's edge) so req.ip is the real client
// and can't be spoofed via X-Forwarded-For to evade rate limits.
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "media-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'self'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ---- sessions (Postgres-backed) ----
if (pool) {
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET || "dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: { sameSite: "lax", secure: "auto", maxAge: 30 * 24 * 60 * 60 * 1000 },
    })
  );
  app.use("/admin", adminRouter);
}

// ---- uploaded media (persistent volume) ----
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "30d" }));

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---- contact form -> Postgres (rate-limited against spam) ----
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many messages from this network. Please try again later." },
});
app.post("/api/contact", contactLimiter, async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true });
  const name = (b.name || "").toString().trim();
  const email = (b.email || "").toString().trim();
  const subject = (b.subject || "").toString().trim();
  const message = (b.message || "").toString().trim();
  if (!email && !message && !name) return res.status(400).json({ ok: false });
  if (!pool) { console.log("📨 Contact (no DB):", { name, email }); return res.json({ ok: true, stored: false }); }
  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name,email,subject,message,payload,source,ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [name, email, subject, message, JSON.stringify(b), (b.source || "home").slice(0, 60), req.ip]
    );
    res.json({ ok: true, stored: true, id: rows[0].id });
  } catch (e) {
    console.error("contact insert failed:", e.message);
    res.status(500).json({ ok: false });
  }
});

// ---- dynamic homepage: inject gallery + clients from the database ----
const INITIAL = 16;
let homeBase = "";
try { homeBase = readFileSync(join(PUBLIC, "index.html"), "utf8"); } catch {}

function renderGallery(photos) {
  const figs = photos
    .map((p, i) =>
      `<figure class="g-item${i >= INITIAL ? " g-hidden" : ""}"><img loading="lazy" decoding="async" src="${esc(p.url)}" alt="${esc(p.caption || "Ten Years Production Laos event in Vientiane")}" /></figure>`)
    .join("");
  let html = `<div class="gallery reveal" id="gallery">${figs}</div>`;
  if (photos.length > INITIAL) {
    html += `\n        <div class="gallery-more">
          <button class="btn btn-ghost" id="loadMore">Load more photos</button>
          <span class="gallery-count">Showing <b id="gShown">${INITIAL}</b> of ${photos.length} photos</span>
        </div>`;
  }
  return html;
}
function renderClients(clients) {
  return clients
    .map((c) => `<img loading="lazy" src="${esc(c.logo_url)}" alt="${esc(c.name || "Client")}" />`)
    .join("");
}

function videoType(url = "") {
  const u = url.toLowerCase();
  if (u.endsWith(".webm")) return "video/webm";
  if (u.endsWith(".mov")) return "video/quicktime";
  if (u.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}

async function serveHome(req, res) {
  let html = homeBase;
  let galleryHtml = "", clientsHtml = "", settings = {};
  try {
    if (pool) {
      const [photos, clients, s] = await Promise.all([getGallery(), getClients(), getSettings()]);
      galleryHtml = renderGallery(photos);
      clientsHtml = renderClients(clients);
      settings = s;
    }
  } catch (e) { console.error("home render error:", e.message); }

  const heroVideo = settings.hero_video_url || "/wp-content/uploads/2024/03/Website-3.mp4";
  const heroPoster = settings.hero_poster_url || "/wp-content/uploads/2024/03/Website-3-poster.jpg";
  html = html
    .replace("<!--GALLERY-->", galleryHtml)
    .replace("<!--CLIENTS-->", clientsHtml)
    .split("__HERO_VIDEO__").join(esc(heroVideo))
    .split("__HERO_POSTER__").join(esc(heroPoster))
    .split("__HERO_TYPE__").join(videoType(heroVideo));

  res.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.type("html").send(html);
}
app.get("/", serveHome);
app.get("/index.html", serveHome);

// ---- static site ----
app.use(
  express.static(PUBLIC, {
    maxAge: "30d",
    setHeaders: (res, fp) => {
      if (fp.endsWith(".html")) res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    },
  })
);

// custom 404
app.use((req, res) => res.status(404).sendFile(join(PUBLIC, "404.html")));

initSchema()
  .catch((e) => console.error("initSchema error:", e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`Ten Years Production Laos on http://localhost:${PORT}`));
  });
