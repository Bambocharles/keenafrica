#!/usr/bin/env python3
"""
Keen Africa: Opportunities blog generator.

Runs every 3 days (via GitHub Actions cron). Uses the Claude Code CLI,
authenticated with a subscription-linked OAuth token (not a billed API key),
with web search to research CURRENT opportunities for ambitious young
Africans (mainly Nigerians), then writes one markdown file per opportunity
plus a manifest JSON. The build script turns these into individual HTML
pages.

Env vars:
  CLAUDE_CODE_OAUTH_TOKEN  (required; from `claude setup-token`)
  MODEL                    (optional, default sonnet)
  MAX_SEARCHES             (optional, default 20)
"""

import json
import os
import re
import subprocess
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = REPO_ROOT / "public" / "blog" / "posts"
CACHE_DIR = REPO_ROOT / "public" / "blog" / "cache"

MODEL = os.environ.get("MODEL", "sonnet")
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


# Cap how many "already published" entries go into the prompt. This list
# only grows (posts drop off it via prune_expired.py, but deadlines often run
# 60+ days out, so it climbs faster than it drains). An unbounded list makes
# the model burn more and more output tokens hunting for non-duplicate
# opportunities each edition, until it overruns the response length and the
# run fails outright (see the 2026-08-25 run: 43 exclusions, truncated,
# unsalvageable). The exact-URL dedup backstop in main() still uses the full
# list regardless of this cap, so capping the prompt only weakens the softer
# "same org, different URL" duplicate check for older editions.
MAX_EXCLUSIONS_IN_PROMPT = 25


def build_research_prompt(existing: list[tuple[str, str]]) -> str:
    already_published = ""
    if existing:
        recent = existing[-MAX_EXCLUSIONS_IN_PROMPT:]
        lines = "\n".join(f"- {title} ({url})" for title, url in recent)
        already_published = f"""
ALREADY PUBLISHED, DO NOT REPEAT: the opportunities below are already live on the site from
past editions. Do not include any of them again, even if you find them via a different page on
the organization's site or a slightly different URL. Same organization + same program + same
intake/cohort counts as the same opportunity, regardless of exact wording or URL:
{lines}

"""

    return f"""Today is {STAMP}. You are researching for Keen Africa, an NGO in Akure,
Nigeria that develops ambitious young Nigerian minds. Research and compile CURRENTLY OPEN
opportunities for young, ambitious Africans, primarily Nigerians. Use web search thoroughly,
up to {MAX_SEARCHES} searches.

Find opportunities in these categories:
1. scholarships: fully/partially funded, to study abroad or at top institutions, open to Nigerians
2. grants: for young entrepreneurs, startups, and innovators in Africa
3. conferences: innovation/tech/leadership events (especially funded or free attendance)
4. competitions: hackathons, business plan competitions, innovation prizes
5. certifications: free courses and certification vouchers (Microsoft Azure, AWS, Google Cloud,
   Cisco, ALX, and similar programs)
{already_published}
STRICT RULES:
- Only include opportunities that are OPEN NOW or opening within the next 60 days.
- Every opportunity MUST include all fields listed in the output format below.
- If you cannot find an official URL or a deadline, EXCLUDE the opportunity.
- Exclude anything that charges an application fee.
- Aim for 2-4 solid opportunities per category. Quality over quantity.
- Do not use em dashes (—) anywhere in your output. Use commas, colons, semicolons, or periods instead.

OUTPUT FORMAT: respond with ONLY a valid JSON object, no prose, no code fences:

{{
  "edition_title": "A compelling title for this edition mentioning month/year",
  "edition_intro": "2-3 sentence intro addressed to ambitious young Nigerians. Confident tone: these readers are builders, not charity cases.",
  "opportunities": [
    {{
      "category": "scholarships",
      "title": "Name of the opportunity",
      "summary": "One sentence: what it offers and why it matters.",
      "deadline": "Exact date e.g. 31 August 2026, or 'Rolling' if no fixed deadline",
      "eligibility": "One line describing who qualifies",
      "apply_url": "https://official-organization-url.org/apply",
      "body_md": "2-3 focused paragraphs of markdown. Cover: what the opportunity offers in detail, who the organizer is, what the application involves, why this one is worth the effort. Be specific and concrete."
    }}
  ]
}}

The opportunities array should contain 10-18 items total across all 5 categories.
Keep each body_md to 2-3 focused paragraphs.
Category values must be exactly one of: scholarships, grants, conferences, competitions, certifications.
Deadlines and apply_url are mandatory: exclude any opportunity missing either.
"""


def call_claude_code(prompt: str) -> dict:
    """Run the research prompt through the Claude Code CLI, headless.

    Authenticated via CLAUDE_CODE_OAUTH_TOKEN (a subscription-linked token
    from `claude setup-token`), so this draws from the Claude subscription's
    included usage rather than metered Anthropic API credits.
    """
    if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        sys.exit("ERROR: CLAUDE_CODE_OAUTH_TOKEN is not set.")

    proc = subprocess.run(
        [
            "claude", "-p", prompt,
            "--output-format", "json",
            "--model", MODEL,
            "--allowedTools", "WebSearch",
        ],
        capture_output=True,
        text=True,
        timeout=1200,
    )
    if proc.returncode != 0:
        sys.exit(f"ERROR: claude CLI exited {proc.returncode}: {proc.stderr[-2000:]}")

    try:
        envelope = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: could not parse claude CLI output: {e}\n{proc.stdout[-2000:]}")

    if envelope.get("is_error"):
        sys.exit(f"ERROR: claude CLI reported an error: {envelope.get('result')}")

    usage = envelope.get("usage", {})
    return {
        "content": [{"type": "text", "text": envelope.get("result", "")}],
        "usage": {
            "input_tokens": usage.get("input_tokens", "?"),
            "output_tokens": usage.get("output_tokens", "?"),
            "server_tool_use": {
                "web_search_requests": usage.get("server_tool_use", {}).get(
                    "web_search_requests", "?"
                )
            },
        },
    }


def extract_json(data: dict) -> dict:
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    raw = "\n".join(p for p in parts if p).strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    # Attempt 1: parse as-is
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Attempt 2: find a JSON object in surrounding prose
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            raw = m.group(0)

    # Attempt 3: salvage truncated JSON, cut back to the last complete
    # opportunity object and close the array + object.
    print("WARNING: JSON appears truncated; attempting salvage…")
    last_complete = -1
    depth = 0
    in_string = False
    escape = False
    for i, ch in enumerate(raw):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 2:          # closed an opportunity object
                last_complete = i
    if last_complete == -1:
        sys.exit("ERROR: could not salvage any complete opportunity from the response.")
    salvaged = raw[: last_complete + 1] + "]}"
    try:
        result = json.loads(salvaged)
        print(f"Salvaged {len(result.get('opportunities', []))} complete opportunities "
              f"from truncated response.")
        return result
    except json.JSONDecodeError as e:
        sys.exit(f"ERROR: salvage failed: {e}")


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60]


def normalize_url(url: str) -> str:
    return (url or "").strip().rstrip("/").lower()


def load_existing_opportunities() -> list[tuple[str, str]]:
    """(title, apply_url) pairs already published, across all past editions.

    The research prompt re-discovers opportunities fresh each run, and often
    finds a different page on the same org's site (or reworded title) for an
    opportunity already live, which would otherwise produce a duplicate post.
    The full list is fed back into the prompt so the model can recognize
    "same organization + same program" duplicates that a URL/title string
    match would miss; main() also does a cheap exact apply_url match as a
    backstop against the model repeating one anyway.
    """
    existing = []
    for path in sorted(POSTS_DIR.glob("*.md")):
        raw = path.read_text()
        m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
        if not m:
            continue
        meta = yaml.safe_load(m.group(1)) or {}
        title = str(meta.get("title", "")).strip()
        url = str(meta.get("apply_url", "")).strip()
        if title and url:
            existing.append((title, url))
    return existing


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
    existing_today = list(POSTS_DIR.glob(f"{STAMP}-*.md"))
    if existing_today:
        print(f"Posts for {STAMP} already exist ({len(existing_today)} files), skipping API call.")
        return

    existing_opportunities = load_existing_opportunities()
    prompt = build_research_prompt(existing_opportunities)

    print(f"Researching opportunities with {MODEL} (max {MAX_SEARCHES} searches), "
          f"excluding {len(existing_opportunities)} already-published…")
    data = call_claude_code(prompt)

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
        "edition_title": parsed.get("edition_title", f"Opportunities: {TODAY.strftime('%B %Y')}"),
        "edition_intro": parsed.get("edition_intro", ""),
        "posts": [],
    }

    seen_urls = {normalize_url(url) for _, url in existing_opportunities}

    for opp in opps:
        cat = opp.get("category", "").lower()
        if cat not in CATEGORIES:
            print(f"  skipping '{opp.get('title')}', unknown category '{cat}'")
            continue
        url = normalize_url(opp.get("apply_url", ""))
        if url and url in seen_urls:
            print(f"  skipping '{opp.get('title')}', already published (apply_url duplicate)")
            continue
        if url:
            seen_urls.add(url)
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