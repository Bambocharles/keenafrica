#!/usr/bin/env python3
"""
Keen Africa: Opportunities blog generator.

Runs every 3 days (via GitHub Actions cron). Uses the Anthropic API (streaming,
via the official SDK) with the native web search tool to research CURRENT
opportunities for ambitious young Africans (mainly Nigerians), then writes one
markdown file per opportunity plus a manifest JSON. The build script turns
these into individual HTML pages.

Env vars:
  ANTHROPIC_API_KEY  (required)
  MODEL              (optional, default claude-sonnet-4-6)
  MAX_SEARCHES       (optional, default 20)
"""

import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import anthropic

REPO_ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = REPO_ROOT / "public" / "blog" / "posts"
CACHE_DIR = REPO_ROOT / "public" / "blog" / "cache"

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
opportunities for young, ambitious Africans, primarily Nigerians. Use web search thoroughly.

Find opportunities in these categories:
1. scholarships: fully/partially funded, to study abroad or at top institutions, open to Nigerians
2. grants: for young entrepreneurs, startups, and innovators in Africa
3. conferences: innovation/tech/leadership events (especially funded or free attendance)
4. competitions: hackathons, business plan competitions, innovation prizes
5. certifications: free courses and certification vouchers (Microsoft Azure, AWS, Google Cloud,
   Cisco, ALX, and similar programs)

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


def call_anthropic() -> dict:
    """Call the API with streaming so long generations don't get disconnected."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        sys.exit("ERROR: ANTHROPIC_API_KEY is not set.")

    client = anthropic.Anthropic(api_key=api_key, max_retries=3)

    with client.messages.stream(
        model=MODEL,
        max_tokens=16000,
        messages=[{"role": "user", "content": RESEARCH_PROMPT}],
        tools=[
            {
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": MAX_SEARCHES,
            }
        ],
    ) as stream:
        final = stream.get_final_message()

    # Convert SDK objects to the dict shape the rest of the script expects
    server_tool_use = getattr(final.usage, "server_tool_use", None)
    return {
        "content": [
            {"type": b.type, "text": getattr(b, "text", "")}
            for b in final.content
        ],
        "usage": {
            "input_tokens": final.usage.input_tokens,
            "output_tokens": final.usage.output_tokens,
            "server_tool_use": {
                "web_search_requests": getattr(
                    server_tool_use, "web_search_requests", "?"
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
        print(f"Posts for {STAMP} already exist ({len(existing)} files), skipping API call.")
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
        "edition_title": parsed.get("edition_title", f"Opportunities: {TODAY.strftime('%B %Y')}"),
        "edition_intro": parsed.get("edition_intro", ""),
        "posts": [],
    }

    for opp in opps:
        cat = opp.get("category", "").lower()
        if cat not in CATEGORIES:
            print(f"  skipping '{opp.get('title')}', unknown category '{cat}'")
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