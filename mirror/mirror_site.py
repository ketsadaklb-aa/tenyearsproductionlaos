#!/usr/bin/env python3
"""Mirror the 3 rendered pages of tenyearsproductionlaos.com into a static site.

- Fetches rendered HTML for Home/About/Contact.
- Collects every self-hosted asset (css/js/images/fonts), incl. url() in CSS
  and inline <style>, and srcset.
- Downloads assets into ../public/<path>, reusing already-downloaded uploads
  from ./site/ instead of re-fetching.
- Rewrites absolute tenyearsproductionlaos.com URLs to root-relative local
  paths (query strings stripped). External hosts are left untouched.
- Skips the 6 video files (decision: handle videos later).
"""
import os, re, sys, shutil, urllib.request, urllib.parse

BASE = "https://tenyearsproductionlaos.com"
HOST = "tenyearsproductionlaos.com"
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, "..", "public"))
LOCAL_MIRROR = os.path.join(HERE, "site")  # already-downloaded files

VIDEO_EXT = (".mp4", ".m4v", ".mov", ".webm")

PAGES = {
    "/": "index.html",
    "/index.php/about/": "about.html",
    "/index.php/contact/": "contact.html",
}

UA = {"User-Agent": "Mozilla/5.0 (site-mirror)"}

downloaded = {}   # url-path -> local relative path (or None if skipped)
seen_assets = set()


def fetch_bytes(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def url_to_localpath(url):
    """Map an absolute site URL to a root-relative local path (query stripped)."""
    p = urllib.parse.urlparse(url)
    path = p.path
    if path.endswith("/") or path == "":
        path = path + "index.html"
    return path.lstrip("/")


def save_asset(url):
    """Download (or copy from local mirror) one asset. Returns local '/...' path
    or None if skipped (video/external/error)."""
    p = urllib.parse.urlparse(url)
    if p.netloc and p.netloc != HOST:
        return None  # external; leave untouched
    localpath = url_to_localpath(url)
    if localpath.lower().endswith(VIDEO_EXT):
        return None  # skip videos for now
    if url in downloaded:
        return downloaded[url]

    dest = os.path.join(PUBLIC, localpath)
    os.makedirs(os.path.dirname(dest), exist_ok=True)

    # Prefer a copy that's already in ./site/ (the full backup).
    src_local = os.path.join(LOCAL_MIRROR, localpath)
    data = None
    if os.path.isfile(src_local):
        with open(src_local, "rb") as f:
            data = f.read()
    else:
        try:
            data = fetch_bytes(url)
        except Exception as e:
            print(f"  ! failed asset {url} ({e})")
            downloaded[url] = None
            return None
    with open(dest, "wb") as f:
        f.write(data)
    result = "/" + localpath
    downloaded[url] = result

    # If it's CSS, recurse into its url() references.
    if localpath.lower().endswith(".css"):
        process_css(dest, url)
    return result


def process_css(css_path, css_url):
    with open(css_path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    base = css_url.rsplit("/", 1)[0] + "/"

    def repl(m):
        raw = m.group(1).strip().strip('"\'')
        if raw.startswith("data:") or raw.startswith("#"):
            return m.group(0)
        absolute = urllib.parse.urljoin(base, raw)
        local = save_asset(absolute)
        if local:
            return f"url({local})"
        return m.group(0)

    new = re.sub(r"url\(([^)]+)\)", repl, text)
    if new != text:
        with open(css_path, "w", encoding="utf-8") as f:
            f.write(new)


def rewrite_html(html):
    """Rewrite self-hosted absolute URLs in attributes & inline styles."""
    # Map internal page permalinks to local files first.
    html = html.replace(f"{BASE}/index.php/about/", "/about.html")
    html = html.replace(f"{BASE}/index.php/contact/", "/contact.html")
    html = re.sub(rf'href=(["\']){re.escape(BASE)}/?\1', r'href=\1/\1', html)

    # Generic: find every http(s)://tenyearsproductionlaos.com/... token in
    # attribute or url() context, download it, and replace with local path.
    pattern = re.compile(r'https?://' + re.escape(HOST) + r'/[^\s"\'\)<>\\]+')

    def repl(m):
        url = m.group(0)
        # strip trailing punctuation that may have been captured
        url = url.rstrip(",;")
        local = save_asset(url)
        if local:
            # preserve query? no — local file has no query
            return local
        return m.group(0)

    html = pattern.sub(repl, html)
    return html


def main():
    if os.path.isdir(PUBLIC):
        # clear old generated html but keep nothing stale
        for name in ("index.html", "styles.css", "about.html", "contact.html"):
            fp = os.path.join(PUBLIC, name)
            if os.path.isfile(fp):
                os.remove(fp)
    os.makedirs(PUBLIC, exist_ok=True)

    for route, outfile in PAGES.items():
        url = BASE + route
        print(f"Fetching {url} -> public/{outfile}")
        html = fetch_bytes(url).decode("utf-8", errors="ignore")
        html = rewrite_html(html)
        with open(os.path.join(PUBLIC, outfile), "w", encoding="utf-8") as f:
            f.write(html)

    n_assets = sum(1 for v in downloaded.values() if v)
    print(f"\nDone. {len(PAGES)} pages, {n_assets} assets localized.")


if __name__ == "__main__":
    main()
