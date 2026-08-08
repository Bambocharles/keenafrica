#!/usr/bin/env python3
"""
Keen Africa: expired-opportunity pruner.

Removes blog posts whose deadline has definitively passed. Only acts on
posts with a parseable fixed date (e.g. "25 July 2026"); anything phrased
as "Rolling", "Ongoing", or similar open-ended text is left alone since
there's no date to compare against.

Deletes the source markdown and the built HTML page, then rebuilds the
index so removed posts drop out of the listing. Run build_blog.py
separately isn't needed; this script calls it directly at the end.
"""

import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = REPO_ROOT / "public" / "blog" / "posts"
HTML_DIR = REPO_ROOT / "public" / "blog"

# Grace period: keep a post for a few days after its deadline in case
# "closing date" traffic still needs the page, or the deadline text was
# slightly conservative.
GRACE_DAYS = 3


def parse_deadline(raw: str) -> date | None:
    """Return a date if `raw` is a parseable fixed date, else None."""
    raw = raw.strip()
    for fmt in ("%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def main() -> None:
    today = date.today()
    removed = []

    for md_path in sorted(POSTS_DIR.glob("*.md")):
        raw = md_path.read_text()
        m = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
        if not m:
            continue
        meta = yaml.safe_load(m.group(1)) or {}
        deadline_raw = str(meta.get("deadline", ""))
        deadline = parse_deadline(deadline_raw)
        if deadline is None:
            continue

        days_past = (today - deadline).days
        if days_past <= GRACE_DAYS:
            continue

        slug = md_path.stem
        html_path = HTML_DIR / f"{slug}.html"

        md_path.unlink()
        if html_path.exists():
            html_path.unlink()

        removed.append((slug, deadline_raw, days_past))

    if not removed:
        print("No expired opportunities to remove.")
        return

    print(f"Removed {len(removed)} expired opportunity page(s):")
    for slug, deadline_raw, days_past in removed:
        print(f"  - {slug}  (deadline: {deadline_raw}, {days_past}d past)")

    print("Rebuilding blog index…")
    sys.stdout.flush()
    subprocess.run(
        [sys.executable, str(REPO_ROOT / "scripts" / "build_blog.py")],
        check=True,
        cwd=REPO_ROOT,
    )


if __name__ == "__main__":
    main()
