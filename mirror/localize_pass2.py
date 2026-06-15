#!/usr/bin/env python3
"""Second pass: localize remaining self-hosted URLs the first pass missed,
including JSON-escaped (https:\\/\\/...) ones inside inline <script> blocks.

For every tenyearsproductionlaos.com asset under wp-content/ or wp-includes/
still referenced absolutely, ensure a local copy exists (copy from ../mirror
backup or download), then rewrite the reference to a root-relative path,
preserving whether it was escaped. Videos are skipped.
"""
import os, re, urllib.request, urllib.parse

HOST = "tenyearsproductionlaos.com"
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, "..", "public"))
LOCAL_MIRROR = os.path.join(HERE, "site")
VIDEO_EXT = (".mp4", ".m4v", ".mov", ".webm")
UA = {"User-Agent": "Mozilla/5.0 (site-mirror)"}

HTML_FILES = ["index.html", "about.html", "contact.html"]

# Matches both normal and JSON-escaped slashes after the host.
# group(1) = path portion using either '/' or '\/' separators (no quotes/spaces)
TOKEN = re.compile(r'https?:(?:\\?/){2}' + re.escape(HOST) + r'((?:\\?/)[^"\'\s\)\\<>]*)')

ensured = {}  # clean_path -> bool exists


def ensure_local(clean_path):
    """clean_path like '/wp-content/uploads/..'. Returns True if available locally."""
    if clean_path in ensured:
        return ensured[clean_path]
    rel = clean_path.lstrip("/")
    # Strip any #fragment or ?query before checking the extension, so URLs like
    # "Website-2.mp4#t=3" are still recognised as videos (and skipped).
    base = rel.split("#", 1)[0].split("?", 1)[0]
    if base.lower().endswith(VIDEO_EXT):
        ensured[clean_path] = False
        return False
    dest = os.path.join(PUBLIC, rel)
    if os.path.isfile(dest):
        ensured[clean_path] = True
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # try backup mirror first
    src = os.path.join(LOCAL_MIRROR, rel)
    data = None
    if os.path.isfile(src):
        with open(src, "rb") as f:
            data = f.read()
    else:
        url = "https://" + HOST + clean_path
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
        except Exception as e:
            print(f"  ! could not fetch {url} ({e})")
            ensured[clean_path] = False
            return False
    with open(dest, "wb") as f:
        f.write(data)
    ensured[clean_path] = True
    return True


def main():
    total_rewrites = 0
    for name in HTML_FILES:
        fp = os.path.join(PUBLIC, name)
        with open(fp, "r", encoding="utf-8", errors="ignore") as f:
            html = f.read()
        count = 0

        def repl(m):
            nonlocal count
            raw_path = m.group(1)               # may contain \/ sequences
            escaped = "\\/" in raw_path
            clean = raw_path.replace("\\/", "/")  # normalized path with leading /
            # only localize wp-content / wp-includes assets
            if not (clean.startswith("/wp-content/") or clean.startswith("/wp-includes/")):
                return m.group(0)
            if not ensure_local(clean):
                return m.group(0)
            count += 1
            return clean.replace("/", "\\/") if escaped else clean

        new = TOKEN.sub(repl, html)
        if new != html:
            with open(fp, "w", encoding="utf-8") as f:
                f.write(new)
        total_rewrites += count
        # report remaining absolute refs
        remaining = len(re.findall(re.escape(HOST), new))
        print(f"{name}: localized {count} more; {remaining} host refs remain")
    print(f"\nTotal extra assets localized: {total_rewrites}")


if __name__ == "__main__":
    main()
