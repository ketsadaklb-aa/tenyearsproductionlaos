import express from "express";
import compression from "compression";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import { pool, initSchema, getGallery, getClients, getSettings, getAvProjects, getAvBrands } from "./db.js";
import adminRouter from "./admin.js";
import { UPLOAD_DIR } from "./uploads.js";
import { getCatalogue, startCatalogueSync } from "./catalogue.js";

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

// ---- public equipment catalogue (synced from the ERP, prices stripped) ----
app.get("/api/catalogue", (req, res) => {
  const c = getCatalogue();
  res.set("Cache-Control", "public, max-age=300");
  res.json({ items: c.items, categories: c.categories, syncedAt: c.syncedAt });
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
// ---- clean URLs ----
// /equipment.html permanently becomes /equipment. The static handler below is
// configured with `extensions: ["html"]`, so the bare path still resolves to
// the same file — no duplicate content, and old links keep working.
app.get(/^\/(.+)\.html$/, (req, res) => {
  const name = req.params[0];
  const q = req.originalUrl.indexOf("?");
  res.redirect(301, (name === "index" ? "/" : "/" + name) + (q === -1 ? "" : req.originalUrl.slice(q)));
});

// ---- equipment page: render the catalogue into the HTML ----
// The grid is built client-side for search and filtering, but that left the
// raw HTML empty. Google runs JavaScript; most AI crawlers do not, so the
// whole inventory was invisible to them. Render it server-side and let the
// script take over for interaction.
let eqBase = "";
try { eqBase = readFileSync(join(PUBLIC, "equipment.html"), "utf8"); } catch {}

function renderCatalogueGrid(items) {
  return items
    .map(
      (it, i) => `<button class="eq-card" type="button" data-i="${i}">
            <div class="eq-shot"><img loading="${i < 12 ? "eager" : "lazy"}" decoding="async" src="${esc(it.photo)}" alt="${esc(it.name)}" /></div>
            <div class="eq-body">
              <span class="eq-cat">${esc(it.category)}</span>
              <h3>${esc(it.name)}</h3>
              <span class="eq-ask">Ask for a price →</span>
            </div>
          </button>`
    )
    .join("\n          ");
}

function renderCatalogueChips(categories, total) {
  return (
    `<button class="chip on" data-cat="">All<span class="n">${total}</span></button>` +
    categories
      .map(
        (c) => `<button class="chip" data-cat="${esc(c.name)}">${esc(c.name)}<span class="n">${c.count}</span></button>`
      )
      .join("")
  );
}

// An ItemList of what we stock. No price or availability is published here,
// so no Offer is claimed — only that the item exists and what it is.
function renderCatalogueSchema(items) {
  if (!items.length) return "";
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Ten Years Production rental equipment catalogue",
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: it.name,
        category: it.category,
        image: `https://tenyearsproductionlaos.com${it.photo}`,
        ...(it.description ? { description: it.description } : {}),
      },
    })),
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

async function serveEquipment(req, res) {
  const c = getCatalogue();
  const n = c.items.length;
  res.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.type("html").send(
    eqBase
      .replace("<!--CAT_GRID-->", renderCatalogueGrid(c.items))
      .replace("<!--CAT_CHIPS-->", renderCatalogueChips(c.categories, n))
      .replace("<!--CAT_COUNT-->", n ? `${n} items in our inventory` : "Loading catalogue…")
      .replace("<!--CAT_SCHEMA-->", renderCatalogueSchema(c.items))
  );
}
app.get("/equipment", serveEquipment);

// ---- AV Solutions page: inject the installation project gallery ----
let avBase = "";
try { avBase = readFileSync(join(PUBLIC, "av-solutions.html"), "utf8"); } catch {}

function renderAvProjects(rows) {
  if (!rows.length) return "";
  // A photo marquee, same idea as the client-logo strip: modern.js duplicates
  // the track so the loop is seamless, and it pauses on hover so a visitor can
  // read a caption or click through to the lightbox.
  const figs = rows
    .map(
      (r) => `<figure class="pm-item">
            <img loading="lazy" decoding="async" src="${esc(r.photo_url)}" alt="${esc([r.title, r.detail].filter(Boolean).join(" — ") || "Ten Years AV Solutions installation")}" />
            ${r.title ? `<figcaption>${esc(r.title)}</figcaption>` : ""}
          </figure>`
    )
    .join("\n          ");
  return `<section class="section-pad" id="work">
      <div class="wrap">
        <div class="section-head">
          <span class="eyebrow">Installed work</span>
          <h2>Recent <span class="grad-text">installations.</span></h2>
          <p>A sample of permanent systems we have specified, installed and commissioned in Laos.</p>
        </div>
      </div>
      <div class="photo-marquee reveal">
        <div class="pm-track">
          ${figs}
        </div>
      </div>
    </section>`;
}

function renderAvBrands(rows) {
  if (!rows.length) return "";
  const items = rows
    .map((r) => {
      // With no logo file the plate carries the name as a wordmark, so the
      // name line underneath would just repeat it.
      const mark = r.logo_url
        ? `<img loading="lazy" decoding="async" src="${esc(r.logo_url)}" alt="${esc(r.name)}" />`
        : `<span class="bm-word">${esc(r.name)}</span>`;
      return `<li class="bm-item">
            <span class="bm-mark">${mark}</span>
            ${r.logo_url ? `<span class="bm-name">${esc(r.name)}</span>` : ""}
            ${r.category ? `<span class="bm-cat">${esc(r.category)}</span>` : ""}
          </li>`;
    })
    .join("\n          ");
  return `<section class="section-pad" id="brands">
      <div class="wrap">
        <div class="section-head">
          <span class="eyebrow">Equipment we supply</span>
          <h2>Brands we specify — <span class="grad-text">or yours.</span></h2>
          <p>We recommend equipment to suit the room, the use and the budget. If your organisation has already standardised on a brand, or a tender names one, we supply and install that instead.</p>
        </div>
        <ul class="brand-grid">
          ${items}
        </ul>
      </div>
    </section>`;
}

async function serveAv(req, res) {
  let projects = [], brands = [];
  try {
    if (pool) [projects, brands] = await Promise.all([getAvProjects(), getAvBrands()]);
  } catch (e) { console.error("av page data error:", e.message); }
  res.set("Cache-Control", "public, max-age=0, must-revalidate");
  res.type("html").send(
    avBase
      .replace("<!--PROJECTS-->", renderAvProjects(projects))
      .replace("<!--BRANDS-->", renderAvBrands(brands))
  );
}
app.get("/av-solutions", serveAv);

app.get("/", serveHome);

// ---- static site ----
app.use(
  express.static(PUBLIC, {
    extensions: ["html"], // /equipment -> public/equipment.html
    maxAge: "30d",
    setHeaders: (res, fp) => {
      if (fp.endsWith(".html")) {
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      } else if (fp.endsWith(".js") || fp.endsWith(".css")) {
        // Scripts and styles change together with the HTML that loads them. A
        // 30-day cache meant a phone could run last week's JS against this
        // week's markup — which is how two burger handlers ended up bound at
        // once, cancelling each other out and leaving the menu button dead.
        // These files are a few KB; revalidating costs a 304.
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      }
    },
  })
);

// custom 404
app.use((req, res) => res.status(404).sendFile(join(PUBLIC, "404.html")));

initSchema()
  .catch((e) => console.error("initSchema error:", e.message))
  .finally(() => {
    startCatalogueSync();

    const server = app.listen(PORT, () =>
      console.log(`Ten Years Production Laos on http://localhost:${PORT}`)
    );

    // Junk/malformed HTTP from bots & port scanners triggers a parser
    // "Parse Error". Answer 400 and close quietly instead of spamming stderr.
    server.on("clientError", (err, socket) => {
      if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    });

    // Graceful shutdown so Railway redeploys exit cleanly (no false "crash").
    const shutdown = (sig) => {
      console.log(`${sig} received — shutting down gracefully`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Last-resort safety net: a single bad request can never take the site down.
    process.on("unhandledRejection", (e) =>
      console.error("unhandledRejection:", e?.message || e)
    );
  });
