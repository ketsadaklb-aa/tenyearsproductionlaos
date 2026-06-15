#!/usr/bin/env python3
"""Strip dead WordPress head cruft and inject SEO + Open Graph meta."""
import os, re, glob

PUBLIC = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public"))
DOMAIN = "https://tenyearsproductionlaos.com"
LOGO = DOMAIN + "/wp-content/uploads/2024/09/Ten-Years-After-Production-Logo-1-1024x1024.png"
SITE = "Ten Years Production Co., Ltd (Laos)"

PAGES = {
    "index.html": {
        "url": DOMAIN + "/",
        "desc": "Ten Years Production Co., Ltd — professional AV and event equipment rental in Vientiane, Laos. Sound, lighting, truss, and stage system rentals for concerts, conferences, and events of any size.",
    },
    "about.html": {
        "url": DOMAIN + "/about.html",
        "desc": "Learn about Ten Years Production — Laos's trusted provider of professional sound, lighting, truss, and stage equipment rental, based in Vientiane.",
    },
    "contact.html": {
        "url": DOMAIN + "/contact.html",
        "desc": "Contact Ten Years Production in Vientiane, Laos for AV and event equipment rental — sound, lighting, truss, and stage systems. Get a quote for your event.",
    },
}

# Patterns for dead WordPress head elements (safe to remove without a backend).
CRUFT = [
    r'<link[^>]*type=["\']application/rss\+xml["\'][^>]*>',
    r'<link[^>]*type=["\']application/(?:json|xml)\+oembed["\'][^>]*>',
    r'<link[^>]*rel=["\']https://api\.w\.org/["\'][^>]*>',
    r'<link[^>]*rel=["\']EditURI["\'][^>]*>',
    r'<link[^>]*rel=["\']wlwmanifest["\'][^>]*>',
    r'<link[^>]*rel=["\']shortlink["\'][^>]*>',
    r'<link[^>]*rel=["\']pingback["\'][^>]*>',
    r'<link[^>]*rel=["\']alternate["\'][^>]*wp-json[^>]*>',
    r'<meta[^>]*name=["\']generator["\'][^>]*>',
    # emoji detection script + smiley style
    r'<script\b[^>]*>\s*window\._wpemojiSettings[\s\S]*?</script>',
    r'<script\b[^>]*src=[^>]*wp-emoji-release[^>]*>\s*</script>',
    r'<style\b[^>]*>[\s\S]*?img\.wp-smiley[\s\S]*?</style>',
]


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


for fp in glob.glob(os.path.join(PUBLIC, "*.html")):
    name = os.path.basename(fp)
    if name not in PAGES:
        continue
    html = open(fp, encoding="utf-8", errors="ignore").read()
    before = html
    removed = 0
    for pat in CRUFT:
        html, n = re.subn(pat, "", html, flags=re.IGNORECASE)
        removed += n

    cfg = PAGES[name]
    # page title text (strip the <title> wrapper)
    m = re.search(r"<title>([^<]*)</title>", html, re.IGNORECASE)
    title = m.group(1).strip() if m else SITE

    if "<!--seo-injected-->" not in html:
        block = f"""<!--seo-injected-->
<meta name="description" content="{esc(cfg['desc'])}">
<link rel="canonical" href="{cfg['url']}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{esc(SITE)}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{esc(cfg['desc'])}">
<meta property="og:url" content="{cfg['url']}">
<meta property="og:image" content="{LOGO}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{esc(cfg['desc'])}">
<meta name="twitter:image" content="{LOGO}">
"""
        # remove any pre-existing canonical (we set our own absolute one)
        html = re.sub(r'<link[^>]*rel=["\']canonical["\'][^>]*>', "", html, flags=re.IGNORECASE)
        html = html.replace("</head>", block + "</head>", 1)

    if html != before:
        open(fp, "w", encoding="utf-8").write(html)
    print(f"{name}: removed {removed} cruft tags, SEO injected")
