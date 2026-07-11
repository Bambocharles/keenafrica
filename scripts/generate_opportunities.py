#!/usr/bin/env python3
"""
Keen Africa — Opportunities blog generator.

Runs every 3 days (via GitHub Actions cron). Uses the Anthropic API with the
native web search tool to research CURRENT opportunities for ambitious young
Africans (mainly Nigerians), then writes one markdown file per opportunity
plus a manifest JSON. The build script turns these into individual HTML pages.

Env vars:
  ANTHROPIC_API_KEY  (required)
  MODEL              (optional, default claude-sonnet-4-6)
  MAX_SEARCHES       (optional, default 20)
"""

import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = REPO_ROOT / "public" / "blog" / "posts"
CACHE_DIR = REPO_ROOT / "public" / "blog" / "cache"

API_URL = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("MODEL", "claude-sonnet-4-6")
MAX_SEARCHES = int(os.environ.get("MAX_SEARCHES", "20"))

TODAY = date.today()
STAMP = TODAY.isoformat()

CATEGORIES = [
    "scholarships",
    "grants",
    "conferences",
    "competitions",
    "certifications",
]

RESEARCH_PROMPT = f"""Today is {STAMP}. You are researching for Keen Africa, an NGO in Akure,
Nigeria that develops ambitious young Nigerian minds. Research and compile CURRENTLY OPEN
opportunities for young, ambitious Africans — primarily Nigerians. Use web search thoroughly.

Find opportunities in these categories:
1. scholarships — fully/partially funded, to study abroad or at top institutions, open to Nigerians
2. grants — for young entrepreneurs, startups, and innovators in Africa
3. conferences — innovation/tech/leadership events (especially funded or free attendance)
4. competitions — hackathons, business plan competitions, innovation prizes
5. certifications — free courses and certification vouchers (Microsoft Azure, AWS, Google Cloud,
   Cisco, ALX, and similar programs)

STRICT RULES:
- Only include opportunities that are OPEN NOW or opening within the next 60 days.
- Every opportunity MUST include all fields listed in the output format below.
- If you cannot find an official URL or a deadline, EXCLUDE the opportunity.
- Exclude anything that charges an application fee.
- Aim for 3–5 solid opportunities per category. Quality over quantity.

OUTPUT FORMAT — respond with ONLY a valid JSON object, no prose, no code fences:

{{
  "edition_title": "A compelling title for this edition mentioning month/year",
  "edition_intro": "2-3 sentence intro addressed to ambitious young Nigerians. Confident tone — these readers are builders, not charity cases.",
  "opportunities": [
    {{
      "category": "scholarships",
      "title": "Name of the opportunity",
      "summary": "One sentence — what it offers and why it matters.",
      "deadline": "Exact date e.g. 31 August 2026, or 'Rolling' if no fixed deadline",
      "eligibility": "One line describing who qualifies",
      "apply_url": "https://official-organization-url.org/apply",
      "body_md": "3-5 paragraphs of markdown. Cover: what the opportunity offers in detail, who the organizer is, what the application involves, why this one is worth the effort. Be specific and concrete."
    }}
  ]
}}

The opportunities array should contain 15-25 items total across all 5 categories.
Category values must be exactly one of: scholarships, grants, conferences, competitions, certifications.
Deadlines and apply_url are mandatory — exclude any opportunity missing either.
"""


def call_anthropic() -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ERROR: ANTHROPIC_API_KEY is not set.")

    body = {
        "model": MODEL,
        "max_tokens": 8000,
        "messages": [{"role": "user", "content": RESEARCH_PROMPT}],
        "tools": [
            {
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": MAX_SEARCHES,
            }
        ],
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body).encode(),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read())


def extract_json(data: dict) -> dict:
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    raw = "\n".join(p for p in parts if p).strip()
    # Strip accidental code fences
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        # Try to find JSON object within the response
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        sys.exit(f"ERROR: could not parse JSON from response: {e}\nRaw: {raw[:500]}")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def write_opportunity(opp: dict, edition_date: str) -> Path:
    slug = f"{edition_date}-{slugify(opp['title'])}"
    path = POSTS_DIR / f"{slug}.md"

    frontmatter = (
        "---\n"
        f'title: "{opp["title"].replace(chr(34), chr(39))}"\n'
        f'category: "{opp["category"]}"\n'
        f'summary: "{opp["summary"].replace(chr(34), chr(39))}"\n'
        f'deadline: "{opp["deadline"]}"\n'
        f'eligibility: "{opp.get("eligibility", "").replace(chr(34), chr(39))}"\n'
        f'apply_url: "{opp["apply_url"]}"\n'
        f"edition_date: {edition_date}\n"
        f"generated: {datetime.now(timezone.utc).isoformat()}\n"
        "---\n\n"
    )
    path.write_text(frontmatter + opp["body_md"].strip() + "\n")
    return path


def main() -> None:
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Duplicate-run guard: skip if this edition already has posts
    existing = list(POSTS_DIR.glob(f"{STAMP}-*.md"))
    if existing:
        print(f"Posts for {STAMP} already exist ({len(existing)} files) — skipping API call.")
        return

    print(f"Researching opportunities with {MODEL} (max {MAX_SEARCHES} searches)…")
    data = call_anthropic()

    # Cache raw response
    cache_path = CACHE_DIR / f"{STAMP}-raw.json"
    cache_path.write_text(json.dumps(data, indent=2))

    usage = data.get("usage", {})
    searches = usage.get("server_tool_use", {}).get("web_search_requests", "?")
    print(f"Done. Searches: {searches}; tokens in/out: "
          f"{usage.get('input_tokens', '?')}/{usage.get('output_tokens', '?')}")

    parsed = extract_json(data)
    opps = parsed.get("opportunities", [])
    if not opps:
        sys.exit("ERROR: no opportunities in response")

    # Write manifest for the build script
    manifest = {
        "edition_date": STAMP,
        "edition_title": parsed.get("edition_title", f"Opportunities — {TODAY.strftime('%B %Y')}"),
        "edition_intro": parsed.get("edition_intro", ""),
        "posts": [],
    }

    for opp in opps:
        cat = opp.get("category", "").lower()
        if cat not in CATEGORIES:
            print(f"  skipping '{opp.get('title')}' — unknown category '{cat}'")
            continue
        path = write_opportunity(opp, STAMP)
        manifest["posts"].append({
            "slug": path.stem,
            "category": cat,
            "title": opp["title"],
            "summary": opp.get("summary", ""),
            "deadline": opp.get("deadline", ""),
            "eligibility": opp.get("eligibility", ""),
            "apply_url": opp.get("apply_url", ""),
        })
        print(f"  wrote {path.name}")

    manifest_path = CACHE_DIR / f"{STAMP}-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {len(manifest['posts'])} opportunities. Manifest: {manifest_path.name}")


if __name__ == "__main__":
    main()