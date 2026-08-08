#!/usr/bin/env python3
"""
Keen Africa: blog builder.

Reads markdown files from public/blog/posts/ and JSON manifests from
public/blog/cache/ and produces:
  - One HTML page per opportunity  (public/blog/<slug>.html)
  - A listing index grouped by category  (public/blog/index.html)

Pure static output. No API calls.
"""

import html
import json
import re
from datetime import date
from pathlib import Path

import markdown
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = REPO_ROOT / "public" / "blog" / "posts"
CACHE_DIR = REPO_ROOT / "public" / "blog" / "cache"
OUT_DIR = REPO_ROOT / "public" / "blog"

GITHUB_REPO = "bambocharles/keenafrica"

CATEGORY_LABELS = {
    "scholarships": "Scholarship",
    "grants": "Grant",
    "conferences": "Conference",
    "competitions": "Competition",
    "certifications": "Free Certification",
}

CATEGORY_ORDER = ["scholarships", "grants", "competitions", "conferences", "certifications"]

CATEGORY_ICONS = {
    "scholarships": "🎓",
    "grants": "💰",
    "conferences": "🌍",
    "competitions": "🏆",
    "certifications": "📜",
}

MD = markdown.Markdown(extensions=["extra", "sane_lists", "smarty"])

# ── Shared styles ─────────────────────────────────────────────────────────────
SHARED_CSS = """
:root {
  --cream:#FAF6EC; --paper:#FFFCF4; --ink:#1F1A14; --ink-soft:#4A3F33;
  --ink-muted:#7A6D5E; --green:#1F3D2A; --green-deep:#15291C;
  --terracotta:#B85C38; --terracotta-soft:#E8B89E; --gold:#D9A852;
  --line:rgba(31,26,20,0.12); --shadow:0 1px 0 rgba(31,26,20,0.04),0 8px 24px rgba(31,26,20,0.06);
  --font-display:"Fraunces","Times New Roman",serif;
  --font-body:"Manrope",system-ui,-apple-system,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0;}
html{scroll-behavior:smooth;}
body{font-family:var(--font-body);background:var(--cream);color:var(--ink);
  line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
a{color:inherit;text-decoration:none;}
.nav{position:sticky;top:0;z-index:50;background:rgba(250,246,236,0.9);
  backdrop-filter:blur(12px);border-bottom:1px solid var(--line);}
.nav-inner{max-width:1100px;margin:0 auto;padding:16px 24px;
  display:flex;align-items:center;justify-content:space-between;gap:24px;}
.logo{display:flex;align-items:center;gap:10px;font-family:var(--font-display);
  font-weight:500;font-size:20px;color:var(--green-deep);}
.logo-mark{width:30px;height:30px;border-radius:8px;display:block;object-fit:contain;}
.back-link{font-size:14px;font-weight:600;color:var(--ink-soft);
  display:inline-flex;align-items:center;gap:6px;}
.back-link:hover{color:var(--green-deep);}
footer{border-top:1px solid var(--line);padding:32px 24px;
  text-align:center;font-size:13px;color:var(--ink-muted);}
footer a{color:var(--green-deep);}
"""

FONTS = """<link rel="icon" type="image/png" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,300..700,30..100&family=Manrope:wght@300;400;500;600;700&display=swap" rel="stylesheet">"""

# ── Opportunity detail page ───────────────────────────────────────────────────
DETAIL_TMPL = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | Keen Africa Opportunities</title>
<meta name="description" content="{summary}">
{fonts}
<style>
{shared_css}
.container{{max-width:760px;margin:0 auto;padding:56px 24px 96px;}}
.badge{{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;
  border-radius:999px;font-size:12px;font-weight:700;letter-spacing:0.08em;
  text-transform:uppercase;background:var(--gold);color:var(--green-deep);margin-bottom:20px;}}
h1{{font-family:var(--font-display);font-weight:400;
  font-size:clamp(30px,5vw,48px);line-height:1.05;letter-spacing:-0.02em;
  color:var(--green-deep);margin-bottom:24px;}}
.meta-bar{{display:flex;flex-wrap:wrap;gap:20px;padding:20px 24px;
  background:var(--paper);border:1px solid var(--line);border-radius:8px;
  margin-bottom:36px;font-size:14px;}}
.meta-item{{display:flex;flex-direction:column;gap:3px;}}
.meta-label{{font-size:11px;font-weight:700;letter-spacing:0.12em;
  text-transform:uppercase;color:var(--ink-muted);}}
.meta-value{{font-weight:600;color:var(--ink);}}
.deadline-val{{color:var(--terracotta);}}
.apply-btn{{display:inline-flex;align-items:center;gap:10px;
  padding:16px 32px;background:var(--terracotta);color:var(--cream);
  border-radius:999px;font-weight:700;font-size:15px;
  transition:background 0.2s,transform 0.2s;margin-bottom:40px;}}
.apply-btn:hover{{background:var(--green-deep);transform:translateY(-2px);}}
.body-content p{{font-size:16.5px;color:var(--ink-soft);
  line-height:1.75;margin-bottom:18px;}}
.body-content h2,.body-content h3{{font-family:var(--font-display);
  color:var(--green-deep);margin:32px 0 12px;}}
.body-content ul,.body-content ol{{margin:0 0 16px 22px;color:var(--ink-soft);}}
.disclaimer{{margin-top:48px;padding:16px 20px;
  background:var(--paper);border:1px solid var(--line);
  border-left:3px solid var(--gold);border-radius:6px;
  font-size:13px;color:var(--ink-muted);line-height:1.6;}}
.disclaimer a{{color:var(--green-deep);text-decoration:underline;}}
</style>
</head>
<body>
<header class="nav">
  <div class="nav-inner">
    <a class="logo" href="../../index.html">
      <img class="logo-mark" src="/logo-icon.png" alt="">Keen Africa
    </a>
    <a class="back-link" href="index.html">← All opportunities</a>
  </div>
</header>
<main class="container">
  <span class="badge">{icon} {category_label}</span>
  <h1>{title}</h1>
  <div class="meta-bar">
    <div class="meta-item">
      <span class="meta-label">Deadline</span>
      <span class="meta-value deadline-val">{deadline}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Eligibility</span>
      <span class="meta-value">{eligibility}</span>
    </div>
  </div>
  <a class="apply-btn" href="{apply_url}" target="_blank" rel="noopener noreferrer">
    Apply now →
  </a>
  <div class="body-content">
    {body_html}
  </div>
  <div class="disclaimer">
    Deadlines and details can change; always confirm on the official page before applying.
    Keen Africa never charges for information about opportunities, and neither should anyone else.<br>
    Spotted an error? <a href="https://github.com/{github_repo}/edit/main/public/blog/posts/{slug}.md">Edit this post on GitHub</a>. Your change opens a pull request we review and merge.
  </div>
</main>
<footer>
  © {year} Keen Africa · Built with conviction ·
  <a href="../../index.html">keenafrica.com</a>
</footer>
</body>
</html>
"""

# ── Listing / index page ──────────────────────────────────────────────────────
INDEX_TMPL = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Opportunities | Keen Africa</title>
<meta name="description" content="Scholarships, grants, competitions, conferences, and free certifications for ambitious young Africans. Researched and verified every few days.">
{fonts}
<style>
{shared_css}
main{{max-width:1100px;margin:0 auto;padding:64px 24px 96px;}}
.kicker{{font-size:12px;font-weight:700;letter-spacing:0.18em;
  text-transform:uppercase;color:var(--terracotta);margin-bottom:14px;}}
h1{{font-family:var(--font-display);font-weight:400;
  font-size:clamp(36px,5vw,60px);line-height:1.02;letter-spacing:-0.02em;
  color:var(--green-deep);margin-bottom:16px;}}
h1 em{{font-style:italic;font-weight:300;color:var(--terracotta);}}
.lead{{font-size:17px;color:var(--ink-soft);max-width:640px;margin-bottom:60px;line-height:1.65;}}
.category-section{{margin-bottom:64px;}}
.category-heading{{display:flex;align-items:center;gap:12px;
  font-family:var(--font-display);font-weight:500;font-size:26px;
  color:var(--green-deep);margin-bottom:24px;padding-bottom:12px;
  border-bottom:2px solid var(--gold);}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;}}
.card{{display:block;background:var(--paper);border:1px solid var(--line);
  border-radius:10px;padding:24px 28px;
  transition:border-color 0.2s,transform 0.2s,box-shadow 0.2s;}}
.card:hover{{border-color:var(--terracotta);transform:translateY(-3px);box-shadow:var(--shadow);}}
.card-deadline{{font-size:11px;font-weight:700;letter-spacing:0.1em;
  text-transform:uppercase;color:var(--terracotta);margin-bottom:8px;}}
.card-title{{font-family:var(--font-display);font-weight:500;font-size:19px;
  color:var(--green-deep);line-height:1.2;margin-bottom:8px;}}
.card-summary{{font-size:14px;color:var(--ink-soft);line-height:1.55;margin-bottom:16px;}}
.card-eligibility{{font-size:12px;color:var(--ink-muted);margin-bottom:16px;
  padding:6px 10px;background:var(--cream);border-radius:4px;}}
.card-cta{{font-size:13px;font-weight:700;color:var(--green-deep);
  display:inline-flex;align-items:center;gap:4px;}}
.card:hover .card-cta{{color:var(--terracotta);}}
.edition-meta{{font-size:13px;color:var(--ink-muted);margin-bottom:48px;}}
@media(max-width:640px){{.cards{{grid-template-columns:1fr;}}}}
</style>
</head>
<body>
<header class="nav">
  <div class="nav-inner">
    <a class="logo" href="../index.html">
      <img class="logo-mark" src="/logo-icon.png" alt="">Keen Africa
    </a>
    <a class="back-link" href="../index.html">← Home</a>
  </div>
</header>
<main>
  <div class="kicker">Updated every few days</div>
  <h1>Opportunities for <em>builders.</em></h1>
  <p class="lead">Scholarships to study abroad, grants for founders, innovation competitions,
  funded conferences, and free cloud certifications, researched against official sources and
  published for ambitious young Africans. No fees. No gatekeeping.</p>
  {edition_meta}
  {category_sections}
</main>
<footer>
  © {year} Keen Africa · Built with conviction ·
  <a href="../index.html">keenafrica.com</a>
</footer>
</body>
</html>
"""


def parse_post(path: Path) -> dict:
    raw = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
    meta = yaml.safe_load(m.group(1)) if m else {}
    body_md = raw[m.end():] if m else raw
    MD.reset()
    return {
        "slug": path.stem,
        "title": str(meta.get("title", path.stem)),
        "category": str(meta.get("category", "scholarships")),
        "summary": str(meta.get("summary", "")),
        "deadline": str(meta.get("deadline", "")),
        "eligibility": str(meta.get("eligibility", "")),
        "apply_url": str(meta.get("apply_url", "#")),
        "edition_date": str(meta.get("edition_date", path.stem[:10])),
        "body_html": MD.convert(body_md),
    }


def build_detail(post: dict) -> None:
    cat = post["category"]
    page = DETAIL_TMPL.format(
        title=html.escape(post["title"]),
        summary=html.escape(post["summary"]),
        icon=CATEGORY_ICONS.get(cat, "✦"),
        category_label=CATEGORY_LABELS.get(cat, cat.title()),
        deadline=html.escape(post["deadline"]),
        eligibility=html.escape(post["eligibility"]),
        apply_url=post["apply_url"],
        body_html=post["body_html"],
        slug=post["slug"],
        github_repo=GITHUB_REPO,
        year=date.today().year,
        fonts=FONTS,
        shared_css=SHARED_CSS,
    )
    out_path = OUT_DIR / f"{post['slug']}.html"
    out_path.write_text(page)
    print(f"  built {out_path.name}")


def build_index(posts: list) -> None:
    # Group by category in defined order
    by_cat: dict = {c: [] for c in CATEGORY_ORDER}
    for p in posts:
        cat = p["category"]
        if cat in by_cat:
            by_cat[cat].append(p)

    # Sort each category by deadline (rolling last)
    def sort_key(p):
        d = p["deadline"].lower()
        if "rolling" in d or "ongoing" in d:
            return "9999-99-99"
        return d

    sections = []
    for cat in CATEGORY_ORDER:
        items = sorted(by_cat[cat], key=sort_key)
        if not items:
            continue
        cards = "\n".join(
            f'<a class="card" href="{p["slug"]}.html">'
            f'<div class="card-deadline">⏰ {html.escape(p["deadline"])}</div>'
            f'<div class="card-title">{html.escape(p["title"])}</div>'
            f'<div class="card-summary">{html.escape(p["summary"])}</div>'
            f'<div class="card-eligibility">👤 {html.escape(p["eligibility"])}</div>'
            f'<span class="card-cta">Read more →</span>'
            f'</a>'
            for p in items
        )
        sections.append(
            f'<section class="category-section">'
            f'<h2 class="category-heading">'
            f'{CATEGORY_ICONS.get(cat, "✦")} {CATEGORY_LABELS.get(cat, cat.title())}s'
            f'</h2>'
            f'<div class="cards">{cards}</div>'
            f'</section>'
        )

    # Edition metadata line
    latest_date = max((p["edition_date"] for p in posts), default="")
    edition_meta = ""
    if latest_date:
        try:
            from datetime import date as dclass
            pretty = dclass.fromisoformat(latest_date).strftime("%B %d, %Y")
            total = len(posts)
            edition_meta = (
                f'<p class="edition-meta">Last updated {pretty} · '
                f'{total} opportunit{"y" if total == 1 else "ies"} across '
                f'{sum(1 for c in CATEGORY_ORDER if by_cat[c])} categories</p>'
            )
        except ValueError:
            pass

    page = INDEX_TMPL.format(
        edition_meta=edition_meta,
        category_sections="\n".join(sections) if sections else
            '<p style="color:var(--ink-muted)">First edition coming soon.</p>',
        year=date.today().year,
        fonts=FONTS,
        shared_css=SHARED_CSS,
    )
    (OUT_DIR / "index.html").write_text(page)
    print(f"built blog/index.html ({len(posts)} opportunities)")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    POSTS_DIR.mkdir(parents=True, exist_ok=True)

    posts = [parse_post(p) for p in sorted(POSTS_DIR.glob("*.md"))]
    if not posts:
        print("No posts found, building empty index.")
        build_index([])
        return

    print(f"Building {len(posts)} opportunity pages…")
    for post in posts:
        build_detail(post)

    build_index(posts)


if __name__ == "__main__":
    main()