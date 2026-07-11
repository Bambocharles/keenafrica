#!/usr/bin/env python3
"""
Keen Africa — blog builder.

Converts every markdown file in site/blog/posts/ into a styled HTML page and
regenerates site/blog/index.html (the listing page). Pure static output —
no API calls, no server. Run on every merge to main.
"""

import html
import re
from datetime import date
from pathlib import Path

import markdown
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = REPO_ROOT / "public" / "blog" / "posts"
CACHE_DIR = REPO_ROOT / "public" / "blog" / "cache"
OUT_DIR = REPO_ROOT / "public" / "blog"

MD = markdown.Markdown(extensions=["extra", "sane_lists", "smarty"])

PAGE_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} — Keen Africa</title>
<meta name="description" content="Opportunities for ambitious young Africans — curated by Keen Africa.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..700,30..100&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {{
  --cream:#FAF6EC; --paper:#FFFCF4; --ink:#1F1A14; --ink-soft:#4A3F33; --ink-muted:#7A6D5E;
  --green:#1F3D2A; --green-deep:#15291C; --terracotta:#B85C38; --gold:#D9A852;
  --line:rgba(31,26,20,0.12);
  --font-display:"Fraunces","Times New Roman",serif; --font-body:"Manrope",system-ui,sans-serif;
}}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family:var(--font-body); background:var(--cream); color:var(--ink); line-height:1.7; -webkit-font-smoothing:antialiased; }}
a {{ color:var(--terracotta); }}
.nav {{ position:sticky; top:0; z-index:50; background:rgba(250,246,236,0.9); backdrop-filter:blur(12px); border-bottom:1px solid var(--line); }}
.nav-inner {{ max-width:860px; margin:0 auto; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; }}
.logo {{ display:flex; align-items:center; gap:10px; font-family:var(--font-display); font-weight:500; font-size:20px; color:var(--green-deep); text-decoration:none; }}
.logo-mark {{ width:30px; height:30px; background:var(--green); border-radius:50%; display:grid; place-items:center; color:var(--gold); font-family:var(--font-display); font-style:italic; font-weight:600; }}
.nav a.back {{ font-size:14px; font-weight:600; color:var(--ink-soft); text-decoration:none; }}
.nav a.back:hover {{ color:var(--green-deep); }}
article {{ max-width:760px; margin:0 auto; padding:56px 24px 96px; }}
.post-meta {{ font-size:13px; letter-spacing:0.1em; text-transform:uppercase; color:var(--terracotta); font-weight:600; margin-bottom:18px; }}
h1 {{ font-family:var(--font-display); font-weight:400; font-size:clamp(34px,5vw,52px); line-height:1.05; letter-spacing:-0.02em; color:var(--green-deep); margin-bottom:20px; }}
h2 {{ font-family:var(--font-display); font-weight:500; font-size:30px; color:var(--green-deep); margin:52px 0 20px; padding-bottom:10px; border-bottom:2px solid var(--gold); }}
h3 {{ font-family:var(--font-display); font-weight:500; font-size:21px; color:var(--green-deep); margin:34px 0 8px; }}
p {{ margin-bottom:16px; color:var(--ink-soft); font-size:16.5px; }}
article > p:first-of-type {{ font-size:19px; color:var(--ink); }}
strong {{ color:var(--ink); }}
hr {{ border:none; border-top:1px solid var(--line); margin:48px 0 24px; }}
em {{ color:var(--ink-muted); }}
ul, ol {{ margin:0 0 16px 22px; color:var(--ink-soft); }}
.disclaimer {{ background:var(--paper); border:1px solid var(--line); border-left:3px solid var(--gold); border-radius:6px; padding:16px 20px; font-size:14px; color:var(--ink-muted); margin-top:40px; }}
footer {{ border-top:1px solid var(--line); padding:28px 24px; text-align:center; font-size:13px; color:var(--ink-muted); }}
footer a {{ color:var(--green-deep); }}
</style>
</head>
<body>
<header class="nav">
  <div class="nav-inner">
    <a class="logo" href="../index.html"><span class="logo-mark">K</span>Keen Africa</a>
    <a class="back" href="index.html">← All opportunities</a>
  </div>
</header>
<article>
  <div class="post-meta">{date_pretty} · Opportunities</div>
  <h1>{title}</h1>
  {body}
  <div class="disclaimer">Deadlines and program details change. Always confirm on the official
  page before applying — and never pay anyone to apply for an opportunity.
  Spotted an error? <a href="{edit_url}">Edit this post on GitHub</a> — your change becomes a
  pull request we review and publish.</div>
</article>
<footer>© {year} Keen Africa · Built in Akure, with conviction · <a href="../index.html">keenafrica.com</a></footer>
</body>
</html>
"""

INDEX_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Opportunities — Keen Africa</title>
<meta name="description" content="Curated, current opportunities for ambitious young Africans: scholarships, grants, competitions, conferences, and free certifications. Refreshed every few days.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..700,30..100&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {{
  --cream:#FAF6EC; --paper:#FFFCF4; --ink:#1F1A14; --ink-soft:#4A3F33; --ink-muted:#7A6D5E;
  --green:#1F3D2A; --green-deep:#15291C; --terracotta:#B85C38; --gold:#D9A852;
  --line:rgba(31,26,20,0.12);
  --font-display:"Fraunces","Times New Roman",serif; --font-body:"Manrope",system-ui,sans-serif;
}}
* {{ box-sizing:border-box; margin:0; padding:0; }}
body {{ font-family:var(--font-body); background:var(--cream); color:var(--ink); line-height:1.6; -webkit-font-smoothing:antialiased; }}
.nav {{ position:sticky; top:0; z-index:50; background:rgba(250,246,236,0.9); backdrop-filter:blur(12px); border-bottom:1px solid var(--line); }}
.nav-inner {{ max-width:860px; margin:0 auto; padding:16px 24px; display:flex; align-items:center; justify-content:space-between; }}
.logo {{ display:flex; align-items:center; gap:10px; font-family:var(--font-display); font-weight:500; font-size:20px; color:var(--green-deep); text-decoration:none; }}
.logo-mark {{ width:30px; height:30px; background:var(--green); border-radius:50%; display:grid; place-items:center; color:var(--gold); font-family:var(--font-display); font-style:italic; font-weight:600; }}
.nav a.back {{ font-size:14px; font-weight:600; color:var(--ink-soft); text-decoration:none; }}
main {{ max-width:860px; margin:0 auto; padding:64px 24px 96px; }}
.kicker {{ font-size:13px; font-weight:600; letter-spacing:0.16em; text-transform:uppercase; color:var(--terracotta); margin-bottom:16px; }}
h1 {{ font-family:var(--font-display); font-weight:400; font-size:clamp(36px,5vw,56px); line-height:1.02; letter-spacing:-0.02em; color:var(--green-deep); margin-bottom:18px; }}
h1 em {{ font-style:italic; font-weight:300; color:var(--terracotta); }}
.lead {{ font-size:17px; color:var(--ink-soft); max-width:620px; margin-bottom:56px; }}
.post-card {{ display:block; background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:28px 32px; margin-bottom:18px; text-decoration:none; transition:border-color .2s, transform .2s; }}
.post-card:hover {{ border-color:var(--terracotta); transform:translateY(-2px); }}
.post-card .date {{ font-size:12px; letter-spacing:0.1em; text-transform:uppercase; color:var(--terracotta); font-weight:600; margin-bottom:8px; }}
.post-card h2 {{ font-family:var(--font-display); font-weight:500; font-size:24px; color:var(--green-deep); line-height:1.2; }}
.post-card .go {{ margin-top:10px; display:inline-block; font-size:14px; font-weight:600; color:var(--green-deep); }}
.empty {{ color:var(--ink-muted); font-size:15px; }}
footer {{ border-top:1px solid var(--line); padding:28px 24px; text-align:center; font-size:13px; color:var(--ink-muted); }}
footer a {{ color:var(--green-deep); }}
</style>
</head>
<body>
<header class="nav">
  <div class="nav-inner">
    <a class="logo" href="../index.html"><span class="logo-mark">K</span>Keen Africa</a>
    <a class="back" href="../index.html">← Home</a>
  </div>
</header>
<main>
  <div class="kicker">Refreshed every few days</div>
  <h1>Opportunities for <em>builders.</em></h1>
  <p class="lead">Scholarships, grants, competitions, conferences, and free certifications —
  researched, verified against official sources, and published for ambitious young Africans.
  No fees, no gatekeeping, no middlemen.</p>
  {cards}
</main>
<footer>© {year} Keen Africa · Built in Akure, with conviction · <a href="../index.html">keenafrica.com</a></footer>
</body>
</html>
"""

GITHUB_REPO = "bambocharles/keenafrica"  # used for "edit on GitHub" links


def parse_post(path: Path) -> dict:
    raw = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
    meta = yaml.safe_load(m.group(1)) if m else {}
    body_md = raw[m.end():] if m else raw
    MD.reset()
    return {
        "slug": path.stem,
        "title": str(meta.get("title", path.stem)),
        "date": str(meta.get("date", path.stem[:10])),
        "html": MD.convert(body_md),
    }


def pretty(d: str) -> str:
    try:
        return date.fromisoformat(d).strftime("%B %d, %Y")
    except ValueError:
        return d


def main() -> None:
    posts = sorted(
        (parse_post(p) for p in POSTS_DIR.glob("*.md")),
        key=lambda p: p["date"],
        reverse=True,
    )
    year = date.today().year

    for post in posts:
        edit_url = f"https://github.com/{GITHUB_REPO}/edit/main/site/blog/posts/{post['slug']}.md"
        page = PAGE_TMPL.format(
            title=html.escape(post["title"]),
            date_pretty=pretty(post["date"]),
            body=post["html"],
            edit_url=edit_url,
            year=year,
        )
        (OUT_DIR / f"{post['slug']}.html").write_text(page)
        print(f"built blog/{post['slug']}.html")

    if posts:
        cards = "\n".join(
            f'<a class="post-card" href="{p["slug"]}.html">'
            f'<div class="date">{pretty(p["date"])}</div>'
            f'<h2>{html.escape(p["title"])}</h2>'
            f'<span class="go">Read the opportunities →</span></a>'
            for p in posts
        )
    else:
        cards = '<p class="empty">First edition coming soon.</p>'

    (OUT_DIR / "index.html").write_text(INDEX_TMPL.format(cards=cards, year=year))
    print(f"built blog/index.html ({len(posts)} post(s))")


if __name__ == "__main__":
    main()
