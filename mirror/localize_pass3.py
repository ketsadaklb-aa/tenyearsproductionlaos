#!/usr/bin/env python3
"""Pass 3: localize any remaining absolute image URLs to the live site,
regardless of surrounding quote style (handles &#039;-quoted carousel logos).
Anchors on the file extension instead of quote characters."""
import os, re, urllib.request

HOST = "tenyearsproductionlaos.com"
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, "..", "public"))
LOCAL_MIRROR = os.path.join(HERE, "site")
UA = {"User-Agent": "Mozilla/5.0 (site-mirror)"}
HTML_FILES = ["index.html", "about.html", "contact.html"]

# absolute (normal or escaped) URL ending in an image/asset extension
EXT = r"(?:png|jpe?g|svg|gif|webp|ico|css|js|woff2?|ttf)"
PAT = re.compile(
    r"https?:(?:\\?/){2}" + re.escape(HOST) +
    r"((?:\\?/)[^\s\"'()<>]*?\." + EXT + r")", re.IGNORECASE)

ensured = {}


def ensure(clean):
    if clean in ensured:
        return ensured[clean]
    rel = clean.lstrip("/")
    dest = os.path.join(PUBLIC, rel)
    if os.path.isfile(dest):
        ensured[clean] = True
        return True
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    src = os.path.join(LOCAL_MIRROR, rel)
    data = None
    if os.path.isfile(src):
        data = open(src, "rb").read()
    else:
        try:
            req = urllib.request.Request("https://" + HOST + clean, headers=UA)
            data = urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:
            print(f"  ! {clean} ({e})")
            ensured[clean] = False
            return False
    open(dest, "wb").write(data)
    ensured[clean] = True
    return True


total = 0
for name in HTML_FILES:
    fp = os.path.join(PUBLIC, name)
    html = open(fp, encoding="utf-8", errors="ignore").read()
    cnt = [0]

    def repl(m):
        raw = m.group(1)
        escaped = "\\/" in raw
        clean = raw.replace("\\/", "/")
        if not ensure(clean):
            return m.group(0)
        cnt[0] += 1
        return (clean.replace("/", "\\/") if escaped else clean)

    new = PAT.sub(repl, html)
    if new != html:
        open(fp, "w", encoding="utf-8").write(new)
    total += cnt[0]
    remaining = len(re.findall(re.escape(HOST), new))
    print(f"{name}: localized {cnt[0]}; {remaining} host refs remain")
print(f"Total: {total}")
