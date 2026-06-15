import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// Railway (and most hosts) inject PORT. Fall back to 3000 locally.
const PORT = process.env.PORT || 3000;

// Serve everything in /public as static files.
app.use(express.static(join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Ten Years Production Laos running on http://localhost:${PORT}`);
});
