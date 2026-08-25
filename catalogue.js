/**
 * Public equipment catalogue — synced from the Ten Years ERP.
 *
 * The ERP exposes GET /api/public/catalog: one row per rental model, with a
 * studio photo (base64 JPEG), a category, a description — and commercial data
 * (day rate, how many units we own, how many are free right now).
 *
 * This module pulls that feed and throws the commercial fields away *here*, on
 * the server, before anything is cached or served. Prices and stock levels
 * never reach the browser, so they can't be read out of the page source or the
 * network tab. Customers ask for a price by email or WhatsApp instead.
 *
 * Photos are written out as ordinary JPEG files on the upload volume, named by
 * a hash of the source image: a 2 MB base64 blob becomes a set of cacheable
 * files the browser can lazy-load. The slim public copy is also kept on disk,
 * so the catalogue still renders while the ERP is restarting or unreachable.
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { readdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

import { UPLOAD_DIR } from "./admin.js";

const ERP_URL =
  process.env.ERP_CATALOG_URL ||
  "https://ten-years-erp-production.up.railway.app/api/public/catalog";
const SYNC_MINUTES = Math.max(5, Number(process.env.CATALOG_SYNC_MINUTES) || 30);
const FETCH_TIMEOUT_MS = 45_000;
const MAX_PHOTO_PX = 800;

const DIR = join(UPLOAD_DIR, "catalogue");
const CACHE_FILE = join(DIR, "catalogue.json");
const PHOTO_PREFIX = "/uploads/catalogue/";

if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });

// Categories come from the ERP as bilingual strings ("Sound System ລະບົບສຽງ").
// Order them the way the homepage talks about our services rather than
// alphabetically, so the page opens on the gear people ask for most.
const CATEGORY_ORDER = ["sound", "lighting", "led", "structure", "effect", "music", "electrical"];
function categoryRank(name) {
  const i = CATEGORY_ORDER.findIndex((k) => name.toLowerCase().includes(k));
  return i === -1 ? CATEGORY_ORDER.length : i;
}

let state = { items: [], categories: [], syncedAt: null };

export function getCatalogue() {
  return state;
}

const DATA_URL = /^data:image\/[a-z.+-]+;base64,/i;

/** base64 image from the ERP -> a cacheable file on the volume; returns its URL. */
async function savePhoto(raw) {
  if (!raw) return null;
  if (!DATA_URL.test(raw)) return /^https?:\/\//i.test(raw) ? raw : null;

  const buf = Buffer.from(raw.slice(raw.indexOf(",") + 1), "base64");
  if (!buf.length) return null;

  // Name by source hash: identical photos share one file, and a URL only
  // changes when the photo itself does — safe to cache hard.
  const name = createHash("sha1").update(buf).digest("hex").slice(0, 16) + ".jpg";
  const file = join(DIR, name);
  if (!existsSync(file)) {
    const out = await sharp(buf, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_PHOTO_PX, height: MAX_PHOTO_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer();
    await writeFile(file, out);
  }
  return PHOTO_PREFIX + name;
}

async function saveCache(data) {
  const tmp = CACHE_FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, CACHE_FILE); // atomic: a crash mid-write can't truncate the cache
}

/** Drop photo files nothing points at any more. Only ever runs after a full,
 *  successful sync, and only inside the catalogue dir this module owns. */
async function prunePhotos(keep) {
  try {
    for (const f of await readdir(DIR)) {
      if (f.endsWith(".jpg") && !keep.has(f)) await unlink(join(DIR, f)).catch(() => {});
    }
  } catch (e) {
    console.error("catalogue prune skipped:", e.message);
  }
}

export async function refreshCatalogue() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let raw;
  try {
    const res = await fetch(ERP_URL, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`ERP responded ${res.status}`);
    raw = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (!Array.isArray(raw)) throw new Error("ERP catalogue feed was not an array");

  const items = [];
  let skipped = 0;
  for (const r of raw) {
    const name = String(r?.modelName ?? "").trim();
    if (!name) continue;

    // A card with no product shot looks unfinished next to the real ones, so
    // gear without a photo in the ERP stays off the public page entirely.
    // Add the photo in the ERP and the next sync brings the item in.
    const photo = await savePhoto(r?.imageUrl);
    if (!photo) {
      skipped++;
      continue;
    }

    items.push({
      id: r.id,
      name,
      category: String(r?.categoryName ?? "").trim() || "Other Equipment",
      description: String(r?.description ?? "").trim(),
      photo,
    });
    // r.rentalDayRate / r.availableUnits / r.totalUnits are deliberately not
    // copied. Nothing downstream can leak what was never carried across.
  }
  if (skipped) console.log(`  (${skipped} catalogue items hidden — no photo in the ERP)`);

  items.sort(
    (a, b) =>
      categoryRank(a.category) - categoryRank(b.category) ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name)
  );

  const counts = new Map();
  for (const it of items) counts.set(it.category, (counts.get(it.category) || 0) + 1);
  const categories = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => categoryRank(a.name) - categoryRank(b.name) || a.name.localeCompare(b.name));

  const next = { items, categories, syncedAt: new Date().toISOString() };
  await saveCache(next);
  state = next;

  await prunePhotos(
    new Set(
      items
        .map((i) => i.photo)
        .filter((p) => p?.startsWith(PHOTO_PREFIX))
        .map((p) => p.slice(PHOTO_PREFIX.length))
    )
  );
  return next;
}

export async function startCatalogueSync() {
  // Serve the last known catalogue immediately, before the ERP is even asked.
  try {
    const cached = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (Array.isArray(cached?.items)) {
      state = cached;
      console.log(`✓ Catalogue cache loaded: ${cached.items.length} items (synced ${cached.syncedAt})`);
    }
  } catch {
    /* no cache yet — first boot */
  }

  const run = async () => {
    try {
      const r = await refreshCatalogue();
      console.log(`✓ Catalogue synced from ERP: ${r.items.length} items in ${r.categories.length} categories`);
    } catch (e) {
      console.error(`catalogue sync failed (serving ${state.items.length} cached items):`, e.message);
    }
  };
  run();
  setInterval(run, SYNC_MINUTES * 60 * 1000).unref();
}
