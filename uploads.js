/**
 * Where uploaded media lives. On Railway this is the mounted persistent volume
 * at /data; locally it falls back to ./uploads-local (git-ignored).
 *
 * This lives in its own module so both admin.js and catalogue.js can use it
 * without importing each other — the admin page needs the catalogue, so the
 * dependency has to run one way only.
 */
import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ||
  (existsSync("/data") ? "/data/uploads" : join(__dirname, "uploads-local"));

if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
