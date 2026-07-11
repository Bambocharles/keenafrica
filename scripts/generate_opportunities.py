#!/usr/bin/env python3
"""
Keen Africa — Opportunities blog generator.

Runs every 3 days (via GitHub Actions cron). Uses the Anthropic API with the
native web search tool to research CURRENT opportunities for ambitious young
Africans (mainly Nigerians), then writes a markdown post with frontmatter to
blog/posts/. The markdown files in git ARE the cache — the website is built
from them statically, so serving the blog costs zero API money. The raw API
response is also cached to blog/cache/ for debugging and to avoid re-runs.

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

RESEARCH_PROMPT = f"""Today is {STAMP}. You are researching for Keen Africa, an NGO in Akure,
Nigeria that develops ambitious young Nigerian minds. Research and compile CURRENTLY OPEN
opportunities for young, ambitious Africans — primarily Nigerians. Use web search thoroughly.

Find opportunities in these categories:
1. SCHOLARSHIPS — fully/partially funded, to study abroad or at top institutions, open to Nigerians
2. GRANTS & FUNDING — for young entrepreneurs, startups, and innovators in Africa
3. CONFERENCES & SUMMITS — innovation/tech/leadership events (especially funded or free attendance)
4. COMPETITIONS & CHALLENGES — hackathons, business plan competitions, innovation prizes
5. FREE TRAINING & CERTIFICATIONS — free courses and certification vouchers (Microsoft Azure,
   AWS, Google Cloud, Cisco, ALX, and similar programs)

STRICT RULES:
- Only include opportunities that are OPEN NOW or opening within the next 60 days.
- Every opportunity MUST include: name, one-paragraph description, who's eligible,
  the DEADLINE (exact date if available), and the OFFICIAL application URL (the
  organization's own site, not an aggregator).
- If you cannot find an official URL or a deadline, EXCLUDE the opportunity.
- Exclude anything that charges an application fee — these are often predatory.
- Aim for 8–15 solid opportunities across the categories. Quality over quantity.

OUTPUT FORMAT — respond with ONLY a markdown document, no preamble, in exactly this structure:

# <A compelling title for this edition, mentioning the month/year>

<A 2-3 sentence intro paragraph addressed to ambitious young Nigerians. Confident tone —
these readers are builders, not charity cases.>

## Scholarships

### <Opportunity name>
**Deadline:** <date> · **Eligibility:** <one line> · **Apply:** <official URL>

<One-paragraph description: what it offers, why it's worth the effort.>

<repeat per opportunity>

## Grants & funding
<same structure>

## Conferences & summits
<same structure>

## Competitions & challenges
<same structure>

## Free training & certifications
<same structure>

---
*Deadlines and details can change. Always confirm on the official page before applying.
Keen Africa never charges for information about opportunities — and neither should anyone else.*
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


def extract_markdown(data: dict) -> str:
    """Concatenate all text blocks from the response."""
    parts = [b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"]
    md = "\n".join(p for p in parts if p).strip()
    # Strip accidental code fences around the whole document
    md = re.sub(r"^```(?:markdown)?\s*", "", md)
    md = re.sub(r"\s*```$", "", md)
    if not md or "## " not in md:
        sys.exit("ERROR: response did not contain a usable markdown document.")
    return md


def main() -> None:
    POSTS_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    post_path = POSTS_DIR / f"{STAMP}-opportunities.md"
    if post_path.exists():
        print(f"Post for {STAMP} already exists — skipping API call (cache hit).")
        return

    print(f"Researching opportunities with {MODEL} (max {MAX_SEARCHES} searches)…")
    data = call_anthropic()

    # Cache the raw response (debugging + audit trail)
    cache_path = CACHE_DIR / f"{STAMP}-raw.json"
    cache_path.write_text(json.dumps(data, indent=2))

    usage = data.get("usage", {})
    searches = usage.get("server_tool_use", {}).get("web_search_requests", "?")
    print(f"Done. Searches used: {searches}; "
          f"tokens in/out: {usage.get('input_tokens', '?')}/{usage.get('output_tokens', '?')}")

    md = extract_markdown(data)

    # Title from the first H1; body without it (build script renders title from frontmatter)
    m = re.match(r"^#\s+(.+?)\s*\n", md)
    title = m.group(1).strip() if m else f"Opportunities for builders — {TODAY.strftime('%B %Y')}"
    body = md[m.end():].strip() if m else md

    frontmatter = (
        "---\n"
        f'title: "{title.replace(chr(34), chr(39))}"\n'
        f"date: {STAMP}\n"
        f"generated: {datetime.now(timezone.utc).isoformat()}\n"
        f"model: {MODEL}\n"
        "status: needs-review\n"
        "---\n\n"
    )
    post_path.write_text(frontmatter + body + "\n")
    print(f"Wrote {post_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
