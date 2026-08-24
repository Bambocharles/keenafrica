#!/usr/bin/env python3
"""
Keen Africa: social post preparer.

Picks the next not-yet-shared opportunity post, generates a branded
1080x1080 card image and a caption. The image is written under
public/social/ (Instagram's Graph API can only fetch images from a
public URL, it doesn't accept direct binary upload, so the card has
to actually deploy with the site); the caption/metadata goes to
social/queue/ for human review (a PR is opened around this by the
GitHub Action).

Nothing is posted to Instagram/Facebook here, see publish_social_post.py,
which only runs after the queued files are merged AND deployed to prod.
"""

import json
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_blog import CATEGORY_ICONS, CATEGORY_LABELS, POSTS_DIR, parse_post  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
SOCIAL_DIR = REPO_ROOT / "social"
QUEUE_DIR = SOCIAL_DIR / "queue"
IMAGE_DIR = REPO_ROOT / "public" / "social"
STATE_PATH = SOCIAL_DIR / "state.json"
CARD_SCRIPT = REPO_ROOT / "scripts" / "social" / "generate_card.js"
SITE_URL = "https://keenafrica.com"

CATEGORY_HASHTAGS = {
    "scholarships": "#Scholarships #StudyAbroad",
    "grants": "#Grants #Funding",
    "conferences": "#Conferences #Networking",
    "competitions": "#Competitions #Hackathon",
    "certifications": "#FreeCertification #TechSkills",
}


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text())
    return {"shared_slugs": []}


def save_state(state: dict) -> None:
    SOCIAL_DIR.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")


def build_caption(post: dict) -> str:
    icon = CATEGORY_ICONS.get(post["category"], "✦")
    label = CATEGORY_LABELS.get(post["category"], post["category"].title())
    hashtags = CATEGORY_HASHTAGS.get(post["category"], "#Opportunities")
    link = f"{SITE_URL}/blog/{post['slug']}.html"

    lines = [
        f"{icon} {post['title']}",
        "",
        post["summary"],
        "",
        f"\U0001F4C5 Deadline: {post['deadline']}",
        f"✅ Eligibility: {post['eligibility']}",
        "",
        "No fees. No gatekeeping. Full details + how to apply (link in bio):",
        link,
        "",
        f"{hashtags} #KeenAfrica #NoFeesEver",
    ]
    return "\n".join(lines)


def generate_card(post: dict, out_path: Path) -> None:
    payload = {
        "title": post["title"],
        "categoryLabel": CATEGORY_LABELS.get(post["category"], post["category"].title()),
        "deadline": f"Deadline: {post['deadline']}",
    }
    result = subprocess.run(
        ["node", str(CARD_SCRIPT), str(out_path)],
        input=json.dumps(payload),
        text=True,
        cwd=CARD_SCRIPT.parent,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Card generation failed: {result.stderr}")


def main() -> None:
    state = load_state()
    shared = set(state["shared_slugs"])

    posts = [parse_post(p) for p in sorted(POSTS_DIR.glob("*.md"))]
    candidates = [p for p in posts if p["slug"] not in shared]

    if not candidates:
        print("No unshared opportunities left, nothing to queue.")
        return

    # Newest edition first, so the promoted opportunity is the least likely
    # to already be past its deadline.
    candidates.sort(key=lambda p: p["edition_date"], reverse=True)
    post = candidates[0]

    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    image_path = IMAGE_DIR / f"{post['slug']}.png"
    meta_path = QUEUE_DIR / f"{post['slug']}.json"

    generate_card(post, image_path)

    meta_path.write_text(
        json.dumps(
            {
                "slug": post["slug"],
                "title": post["title"],
                "category": post["category"],
                "caption": build_caption(post),
                "image_url": f"{SITE_URL}/social/{post['slug']}.png",
                "queued_at": datetime.now().isoformat(),
            },
            indent=2,
        )
        + "\n"
    )

    state["shared_slugs"].append(post["slug"])
    save_state(state)

    print(f"Queued: {post['slug']}")
    print(f"  image:   {image_path}")
    print(f"  caption: {meta_path}")


if __name__ == "__main__":
    main()
