import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import sharp from "sharp";
import { existsSync, mkdirSync } from "fs";
import { writeFile } from "fs/promises";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { pool, getSettings, setSetting, getDocuments } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ||
  (existsSync("/data") ? "/data/uploads" : join(__dirname, "uploads-local"));
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Disk-based uploader for large files (video/PDF) — streamed straight to the
// volume so big files don't sit in memory.
const SAFE_EXT = /\.(mp4|m4v|mov|webm|pdf|jpg|jpeg|png|webp)$/i;
const uploadRaw = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (extname(file.originalname) || "").toLowerCase();
      cb(null, `${Date.now().toString(36)}-${Math.round(performance.now())}${ext}`);
    },
  }),
  limits: { fileSize: 400 * 1024 * 1024 }, // 400 MB
  fileFilter: (req, file, cb) => cb(null, SAFE_EXT.test(file.originalname)),
});

const router = express.Router();

// ---------- helpers ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.redirect("/admin/login");
}
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === "admin") return next();
  return res.status(403).send(page("Forbidden", "<p>Admins only.</p>", req));
}
async function uniqueName(buf, ext) {
  const stamp = Date.now().toString(36);
  const rnd = (buf[0] || 0).toString(16) + (buf[buf.length - 1] || 0).toString(16) + buf.length.toString(36);
  return `${stamp}-${rnd}.${ext}`;
}

function page(title, body, req) {
  const u = req?.session?.user;
  const nav = u
    ? `<nav class="anav">
        <a href="/admin">Dashboard</a><a href="/admin/photos">Photos</a>
        <a href="/admin/clients">Clients</a><a href="/admin/media">Media</a><a href="/admin/submissions">Submissions</a>
        ${u.role === "admin" ? '<a href="/admin/team">Team</a>' : ""}
        <span class="who">${esc(u.name)} · <a href="/admin/account">account</a> · <a href="/admin/logout">logout</a></span>
       </nav>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/><title>${esc(title)} — Admin</title>
<style>
:root{--red:#e63329}
*{box-sizing:border-box} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0a0a0a;color:#f0f0f0}
a{color:#e63329;text-decoration:none} a:hover{text-decoration:underline}
.anav{display:flex;gap:1.2rem;align-items:center;padding:1rem 1.5rem;background:#121212;border-bottom:1px solid #222;flex-wrap:wrap}
.anav a{color:#ddd;font-weight:600} .anav a:hover{color:#fff} .anav .who{margin-left:auto;color:#888;font-weight:400;font-size:.9rem}
.wrap{max-width:1000px;margin:0 auto;padding:2rem 1.5rem}
h1{font-size:1.6rem;margin:.2rem 0 1.4rem} h2{font-size:1.1rem;margin:2rem 0 1rem}
.card{background:#151515;border:1px solid #262626;border-radius:12px;padding:1.4rem;margin-bottom:1.4rem}
label{display:block;font-size:.85rem;color:#aaa;margin:.8rem 0 .4rem}
input,textarea,select{width:100%;padding:.7rem .8rem;background:#0c0c0c;border:1px solid #2a2a2a;border-radius:8px;color:#fff;font:inherit}
input[type=file]{padding:.5rem}
.btn{display:inline-flex;gap:.4rem;align-items:center;background:var(--red);color:#fff;border:0;border-radius:999px;padding:.6rem 1.2rem;font-weight:600;cursor:pointer;font-size:.92rem}
.btn:hover{filter:brightness(1.1)} .btn.ghost{background:#222;color:#eee} .btn.sm{padding:.35rem .7rem;font-size:.8rem}
.btn.danger{background:#3a1414;color:#ff9d97;border:1px solid #5a1f1f}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem}
.tile{background:#0c0c0c;border:1px solid #262626;border-radius:10px;overflow:hidden;position:relative}
.tile img{width:100%;height:120px;object-fit:cover;display:block;background:#fff}
.tile .bar{display:flex;gap:.3rem;padding:.5rem;flex-wrap:wrap;align-items:center}
.tile.hidden-item{opacity:.45}
.msg{padding:.9rem 1rem;border-radius:8px;margin-bottom:1.2rem;font-weight:600}
.msg.ok{background:#13301a;color:#8fe6a8;border:1px solid #2a6b3c}
.msg.err{background:#3a1414;color:#ff9d97;border:1px solid #5a1f1f}
table{width:100%;border-collapse:collapse;font-size:.9rem} th,td{border:1px solid #262626;padding:.6rem;text-align:left;vertical-align:top}
th{background:#181818} .muted{color:#888;font-size:.85rem}
.dash{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem}
.dash a{display:block;background:#151515;border:1px solid #262626;border-radius:12px;padding:1.6rem;color:#fff;font-weight:600}
.dash a:hover{border-color:var(--red);text-decoration:none}
.dash a b{display:block;font-size:1.6rem;margin-bottom:.3rem;color:var(--red)}
form.inline{display:inline}
</style></head><body>${nav}<div class="wrap">${body}</div></body></html>`;
}
function flash(req) {
  const m = req.session.flash;
  req.session.flash = null;
  return m ? `<div class="msg ${m.t}">${esc(m.m)}</div>` : "";
}
function setFlash(req, t, m) { req.session.flash = { t, m }; }

// ---------- auth ----------
router.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/admin");
  res.send(page("Login",
    `<h1>Ten Years Production — Admin</h1>${flash(req)}
     <div class="card" style="max-width:380px">
       <form method="post" action="/admin/login">
         <label>Email</label><input name="email" type="email" required autofocus/>
         <label>Password</label><input name="password" type="password" required/>
         <div style="margin-top:1.2rem"><button class="btn" type="submit">Log in</button></div>
       </form></div>`, req));
});
router.post("/login", async (req, res) => {
  const email = (req.body.email || "").toLowerCase().trim();
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [email]);
  const user = rows[0];
  if (user && (await bcrypt.compare(req.body.password || "", user.password_hash))) {
    req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
    return res.redirect("/admin");
  }
  setFlash(req, "err", "Invalid email or password.");
  res.redirect("/admin/login");
});
router.get("/logout", (req, res) => { req.session.destroy(() => res.redirect("/admin/login")); });

// ---------- dashboard ----------
router.get("/", requireAuth, async (req, res) => {
  const p = await pool.query("SELECT count(*)::int n FROM gallery_photos");
  const c = await pool.query("SELECT count(*)::int n FROM clients");
  const s = await pool.query("SELECT count(*)::int n, count(*) FILTER (WHERE NOT handled)::int unread FROM contacts");
  res.send(page("Dashboard",
    `<h1>Welcome, ${esc(req.session.user.name)}</h1>${flash(req)}
     <div class="dash">
       <a href="/admin/photos"><b>${p.rows[0].n}</b>Gallery photos →</a>
       <a href="/admin/clients"><b>${c.rows[0].n}</b>Client logos →</a>
       <a href="/admin/submissions"><b>${s.rows[0].unread}</b>New inquiries (${s.rows[0].n} total) →</a>
     </div>`, req));
});

// ---------- image processing ----------
async function processAndSave(file, { logo = false } = {}) {
  let img = sharp(file.buffer, { failOn: "none" }).rotate();
  const meta = await img.metadata();
  if (logo) {
    img = img.resize({ width: 600, height: 600, fit: "inside", withoutEnlargement: true });
    const isPng = (meta.format === "png" || meta.hasAlpha);
    const ext = isPng ? "png" : "jpg";
    const out = isPng ? await img.png().toBuffer() : await img.jpeg({ quality: 86 }).toBuffer();
    const name = await uniqueName(out, ext);
    await writeFile(join(UPLOAD_DIR, name), out);
    return `/uploads/${name}`;
  }
  img = img.resize({ width: 1600, withoutEnlargement: true });
  const out = await img.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  const name = await uniqueName(out, "jpg");
  await writeFile(join(UPLOAD_DIR, name), out);
  return `/uploads/${name}`;
}

// ---------- photos ----------
router.get("/photos", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM gallery_photos ORDER BY sort_order ASC, id ASC");
  const tiles = rows.map((r, i) => `
    <div class="tile ${r.visible ? "" : "hidden-item"}">
      <img src="${esc(r.url)}" loading="lazy" alt=""/>
      <div class="bar">
        <form class="inline" method="post" action="/admin/photos/${r.id}/move"><input type="hidden" name="dir" value="-1"/><button class="btn ghost sm" ${i === 0 ? "disabled" : ""}>↑</button></form>
        <form class="inline" method="post" action="/admin/photos/${r.id}/move"><input type="hidden" name="dir" value="1"/><button class="btn ghost sm" ${i === rows.length - 1 ? "disabled" : ""}>↓</button></form>
        <form class="inline" method="post" action="/admin/photos/${r.id}/toggle"><button class="btn ghost sm">${r.visible ? "Hide" : "Show"}</button></form>
        <form class="inline" method="post" action="/admin/photos/${r.id}/delete" onsubmit="return confirm('Delete this photo?')"><button class="btn danger sm">Delete</button></form>
      </div>
    </div>`).join("");
  res.send(page("Photos",
    `<h1>Gallery photos (${rows.length})</h1>${flash(req)}
     <div class="card">
       <form method="post" action="/admin/photos/upload" enctype="multipart/form-data">
         <label>Add photos (you can select several — they're auto-resized)</label>
         <input type="file" name="photos" accept="image/*" multiple required/>
         <div style="margin-top:1rem"><button class="btn" type="submit">Upload</button></div>
       </form></div>
     <p class="muted">Newest first by default. Use ↑ ↓ to reorder, Hide to keep a photo off the site without deleting.</p>
     <div class="grid">${tiles}</div>`, req));
});
router.post("/photos/upload", requireAuth, upload.array("photos", 40), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT COALESCE(MIN(sort_order),0) m FROM gallery_photos");
    let order = rows[0].m - 1;
    for (const f of req.files || []) {
      const url = await processAndSave(f, { logo: false });
      await pool.query("INSERT INTO gallery_photos (url, sort_order) VALUES ($1,$2)", [url, order--]);
    }
    setFlash(req, "ok", `${(req.files || []).length} photo(s) added.`);
  } catch (e) { setFlash(req, "err", "Upload failed: " + e.message); }
  res.redirect("/admin/photos");
});
router.post("/photos/:id/toggle", requireAuth, async (req, res) => {
  await pool.query("UPDATE gallery_photos SET visible = NOT visible WHERE id=$1", [req.params.id]);
  res.redirect("/admin/photos");
});
router.post("/photos/:id/delete", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM gallery_photos WHERE id=$1", [req.params.id]);
  setFlash(req, "ok", "Photo deleted.");
  res.redirect("/admin/photos");
});
router.post("/photos/:id/move", requireAuth, async (req, res) => {
  await moveRow("gallery_photos", req.params.id, parseInt(req.body.dir, 10));
  res.redirect("/admin/photos");
});

// ---------- clients ----------
router.get("/clients", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM clients ORDER BY sort_order ASC, id ASC");
  const tiles = rows.map((r, i) => `
    <div class="tile ${r.visible ? "" : "hidden-item"}">
      <img src="${esc(r.logo_url)}" loading="lazy" alt="" style="object-fit:contain;padding:10px"/>
      <div class="bar">
        <form class="inline" method="post" action="/admin/clients/${r.id}/move"><input type="hidden" name="dir" value="-1"/><button class="btn ghost sm" ${i === 0 ? "disabled" : ""}>↑</button></form>
        <form class="inline" method="post" action="/admin/clients/${r.id}/move"><input type="hidden" name="dir" value="1"/><button class="btn ghost sm" ${i === rows.length - 1 ? "disabled" : ""}>↓</button></form>
        <form class="inline" method="post" action="/admin/clients/${r.id}/toggle"><button class="btn ghost sm">${r.visible ? "Hide" : "Show"}</button></form>
        <form class="inline" method="post" action="/admin/clients/${r.id}/delete" onsubmit="return confirm('Delete this logo?')"><button class="btn danger sm">Delete</button></form>
      </div>
      <div style="padding:0 .5rem .5rem"><span class="muted">${esc(r.name || "—")}</span></div>
    </div>`).join("");
  res.send(page("Clients",
    `<h1>Client logos (${rows.length})</h1>${flash(req)}
     <div class="card">
       <form method="post" action="/admin/clients/upload" enctype="multipart/form-data">
         <label>Logo image (PNG with transparent background works best)</label>
         <input type="file" name="logo" accept="image/*" required/>
         <label>Client name (optional)</label><input name="name" placeholder="e.g. Beerlao"/>
         <div style="margin-top:1rem"><button class="btn" type="submit">Add logo</button></div>
       </form></div>
     <div class="grid">${tiles}</div>`, req));
});
router.post("/clients/upload", requireAuth, upload.single("logo"), async (req, res) => {
  try {
    const url = await processAndSave(req.file, { logo: true });
    const { rows } = await pool.query("SELECT COALESCE(MAX(sort_order),0)+1 m FROM clients");
    await pool.query("INSERT INTO clients (name, logo_url, sort_order) VALUES ($1,$2,$3)",
      [req.body.name || "", url, rows[0].m]);
    setFlash(req, "ok", "Logo added.");
  } catch (e) { setFlash(req, "err", "Upload failed: " + e.message); }
  res.redirect("/admin/clients");
});
router.post("/clients/:id/toggle", requireAuth, async (req, res) => {
  await pool.query("UPDATE clients SET visible = NOT visible WHERE id=$1", [req.params.id]);
  res.redirect("/admin/clients");
});
router.post("/clients/:id/delete", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM clients WHERE id=$1", [req.params.id]);
  setFlash(req, "ok", "Logo deleted.");
  res.redirect("/admin/clients");
});
router.post("/clients/:id/move", requireAuth, async (req, res) => {
  await moveRow("clients", req.params.id, parseInt(req.body.dir, 10));
  res.redirect("/admin/clients");
});

// swap sort_order with the neighbour in the given direction
async function moveRow(table, id, dir) {
  const { rows } = await pool.query(`SELECT id, sort_order FROM ${table} ORDER BY sort_order ASC, id ASC`);
  const idx = rows.findIndex((r) => r.id === Number(id));
  const swap = idx + (dir < 0 ? -1 : 1);
  if (idx < 0 || swap < 0 || swap >= rows.length) return;
  const a = rows[idx], b = rows[swap];
  await pool.query(`UPDATE ${table} SET sort_order=$1 WHERE id=$2`, [b.sort_order, a.id]);
  await pool.query(`UPDATE ${table} SET sort_order=$1 WHERE id=$2`, [a.sort_order, b.id]);
}

// ---------- submissions ----------
router.get("/submissions", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM contacts ORDER BY id DESC LIMIT 500");
  const trs = rows.map((r) => `<tr style="${r.handled ? "opacity:.55" : ""}">
    <td>${esc(new Date(r.created_at).toLocaleString())}</td>
    <td>${esc(r.name)}<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></td>
    <td><b>${esc(r.subject)}</b><br>${esc(r.message)}</td>
    <td><form method="post" action="/admin/submissions/${r.id}/handled"><button class="btn ghost sm">${r.handled ? "Mark new" : "Mark done"}</button></form></td>
  </tr>`).join("");
  res.send(page("Submissions",
    `<h1>Contact inquiries (${rows.length})</h1>${flash(req)}
     <table><thead><tr><th>When</th><th>From</th><th>Message</th><th></th></tr></thead>
     <tbody>${trs || '<tr><td colspan="4">No inquiries yet.</td></tr>'}</tbody></table>`, req));
});
router.post("/submissions/:id/handled", requireAuth, async (req, res) => {
  await pool.query("UPDATE contacts SET handled = NOT handled WHERE id=$1", [req.params.id]);
  res.redirect("/admin/submissions");
});

// ---------- team (admin only) ----------
router.get("/team", requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query("SELECT id,email,name,role,created_at FROM users ORDER BY id");
  const trs = rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${esc(r.role)}</td>
    <td>${r.id === req.session.user.id ? '<span class="muted">you</span>' :
      `<form method="post" action="/admin/team/${r.id}/delete" onsubmit="return confirm('Remove this team member?')"><button class="btn danger sm">Remove</button></form>`}</td></tr>`).join("");
  res.send(page("Team",
    `<h1>Team members</h1>${flash(req)}
     <div class="card"><h2 style="margin-top:0">Add a member</h2>
       <form method="post" action="/admin/team/add">
         <label>Name</label><input name="name" required/>
         <label>Email</label><input name="email" type="email" required/>
         <label>Temporary password</label><input name="password" required minlength="6"/>
         <label>Role</label><select name="role"><option value="editor">Editor (manage content)</option><option value="admin">Admin (also manage team)</option></select>
         <div style="margin-top:1rem"><button class="btn">Add member</button></div>
       </form></div>
     <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>${trs}</tbody></table>`, req));
});
router.post("/team/add", requireAuth, requireAdmin, async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const hash = await bcrypt.hash(req.body.password, 10);
    await pool.query("INSERT INTO users (email,name,password_hash,role) VALUES ($1,$2,$3,$4)",
      [email, req.body.name, hash, req.body.role === "admin" ? "admin" : "editor"]);
    setFlash(req, "ok", "Team member added.");
  } catch (e) { setFlash(req, "err", e.message.includes("unique") ? "That email already exists." : e.message); }
  res.redirect("/admin/team");
});
router.post("/team/:id/delete", requireAuth, requireAdmin, async (req, res) => {
  if (Number(req.params.id) !== req.session.user.id)
    await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
  res.redirect("/admin/team");
});

// ---------- account (change own password) ----------
router.get("/account", requireAuth, (req, res) => {
  res.send(page("Account",
    `<h1>My account</h1>${flash(req)}
     <div class="card" style="max-width:420px"><h2 style="margin-top:0">Change password</h2>
       <form method="post" action="/admin/account/password">
         <label>Current password</label><input name="current" type="password" required/>
         <label>New password</label><input name="next" type="password" required minlength="6"/>
         <div style="margin-top:1rem"><button class="btn">Update password</button></div>
       </form></div>`, req));
});
router.post("/account/password", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM users WHERE id=$1", [req.session.user.id]);
  if (!(await bcrypt.compare(req.body.current || "", rows[0].password_hash))) {
    setFlash(req, "err", "Current password is incorrect.");
  } else {
    const hash = await bcrypt.hash(req.body.next, 10);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.session.user.id]);
    setFlash(req, "ok", "Password updated.");
  }
  res.redirect("/admin/account");
});

// ---------- media: hero video + documents (PDF etc.) ----------
function fmtSize(n) {
  n = Number(n) || 0;
  if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n > 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}
router.get("/media", requireAuth, async (req, res) => {
  const s = await getSettings();
  const docs = await getDocuments();
  const docRows = docs.map((d) => `<tr>
      <td><b>${esc(d.title || d.filename)}</b><br><span class="muted">${esc(d.filename)} · ${fmtSize(d.size_bytes)}</span></td>
      <td><a href="${esc(d.url)}" target="_blank">Open</a></td>
      <td><button class="btn ghost sm copy" data-url="${esc(d.url)}">Copy link</button></td>
      <td><form method="post" action="/admin/documents/${d.id}/delete" onsubmit="return confirm('Delete this document?')"><button class="btn danger sm">Delete</button></form></td>
    </tr>`).join("");
  res.send(page("Media",
    `<h1>Media & documents</h1>${flash(req)}

     <div class="card">
       <h2 style="margin-top:0">Homepage hero video</h2>
       <video src="${esc(s.hero_video_url || "")}" muted controls playsinline style="max-width:360px;border-radius:10px;background:#000"></video>
       <form method="post" action="/admin/media/hero-video" enctype="multipart/form-data">
         <label>Replace hero video (MP4 recommended, up to 400 MB — it autoplays muted, so keep it short)</label>
         <input type="file" name="video" accept="video/*"/>
         <label>Poster image (optional — shows before the video loads)</label>
         <input type="file" name="poster" accept="image/*"/>
         <div style="margin-top:1rem"><button class="btn" type="submit">Update hero video</button></div>
       </form>
     </div>

     <div class="card">
       <h2 style="margin-top:0">Documents (PDF, catalogs, rate cards)</h2>
       <form method="post" action="/admin/media/document" enctype="multipart/form-data">
         <label>Title (optional)</label><input name="title" placeholder="e.g. 2026 Equipment Catalog"/>
         <label>File (PDF or image, up to 400 MB)</label><input type="file" name="file" accept=".pdf,image/*" required/>
         <div style="margin-top:1rem"><button class="btn" type="submit">Upload document</button></div>
       </form>
       <table style="margin-top:1.4rem"><thead><tr><th>Document</th><th></th><th></th><th></th></tr></thead>
       <tbody>${docRows || '<tr><td colspan="4" class="muted">No documents yet.</td></tr>'}</tbody></table>
       <p class="muted">Each document gets a public link your team can share or I can place on the site.</p>
     </div>

     <script>
       document.querySelectorAll('.copy').forEach(function(b){
         b.addEventListener('click',function(){
           navigator.clipboard.writeText(location.origin+b.dataset.url);
           b.textContent='Copied!'; setTimeout(function(){b.textContent='Copy link';},1500);
         });
       });
     </script>`, req));
});
router.post("/media/hero-video", requireAuth,
  uploadRaw.fields([{ name: "video", maxCount: 1 }, { name: "poster", maxCount: 1 }]),
  async (req, res) => {
    try {
      const v = req.files?.video?.[0];
      const p = req.files?.poster?.[0];
      if (v) await setSetting("hero_video_url", `/uploads/${v.filename}`);
      if (p) await setSetting("hero_poster_url", `/uploads/${p.filename}`);
      setFlash(req, v || p ? "ok" : "err", v || p ? "Hero video updated." : "No file selected.");
    } catch (e) { setFlash(req, "err", "Failed: " + e.message); }
    res.redirect("/admin/media");
  });
router.post("/media/document", requireAuth, uploadRaw.single("file"), async (req, res) => {
  try {
    if (!req.file) throw new Error("No file (allowed: PDF/image)");
    await pool.query(
      "INSERT INTO documents (title, url, filename, size_bytes) VALUES ($1,$2,$3,$4)",
      [req.body.title || "", `/uploads/${req.file.filename}`, req.file.originalname, req.file.size]
    );
    setFlash(req, "ok", "Document uploaded.");
  } catch (e) { setFlash(req, "err", "Failed: " + e.message); }
  res.redirect("/admin/media");
});
router.post("/documents/:id/delete", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM documents WHERE id=$1", [req.params.id]);
  setFlash(req, "ok", "Document deleted.");
  res.redirect("/admin/media");
});

export default router;
