#!/usr/bin/env python3
"""
Keen Africa: social post publisher.

Publishes every queued-and-approved post (social/queue/*.json) to the
Facebook Page and Instagram Business account via the Meta Graph API,
then archives it to social/posted/ so it isn't published twice.

Only run this AFTER the corresponding public/social/<slug>.png has
actually deployed to production, Instagram's Graph API fetches the
image from its public URL rather than accepting a direct upload, so it
has to be live first. See .github/workflows/publish-social-post.yml,
which triggers off the Deploy workflow's completion.

Required environment variables:
  META_PAGE_ID                 Facebook Page ID
  META_PAGE_ACCESS_TOKEN       Long-lived Page access token
  META_IG_BUSINESS_ACCOUNT_ID  Instagram Business Account ID (linked to the Page)

See scripts/social/README.md for how to obtain these.
"""

import json
import os
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph_api import post_to_facebook, post_to_instagram  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
SOCIAL_DIR = REPO_ROOT / "social"
QUEUE_DIR = SOCIAL_DIR / "queue"
POSTED_DIR = SOCIAL_DIR / "posted"


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> None:
    page_id = env("META_PAGE_ID")
    page_token = env("META_PAGE_ACCESS_TOKEN")
    ig_user_id = env("META_IG_BUSINESS_ACCOUNT_ID")

    queued = sorted(QUEUE_DIR.glob("*.json")) if QUEUE_DIR.exists() else []
    if not queued:
        print("Nothing queued to publish.")
        return

    POSTED_DIR.mkdir(parents=True, exist_ok=True)
    failures = []

    for meta_path in queued:
        meta = json.loads(meta_path.read_text())
        slug = meta["slug"]
        print(f"Publishing {slug}...")
        try:
            fb_id = post_to_facebook(page_id, page_token, meta["image_url"], meta["caption"])
            print(f"  Facebook post id: {fb_id}")
            ig_id = post_to_instagram(ig_user_id, page_token, meta["image_url"], meta["caption"])
            print(f"  Instagram post id: {ig_id}")
        except requests.HTTPError as err:
            print(f"  FAILED: {err.response.text}", file=sys.stderr)
            failures.append(slug)
            continue

        meta["facebook_post_id"] = fb_id
        meta["instagram_post_id"] = ig_id
        (POSTED_DIR / meta_path.name).write_text(json.dumps(meta, indent=2) + "\n")
        meta_path.unlink()

    if failures:
        raise SystemExit(f"Failed to publish: {', '.join(failures)}")


if __name__ == "__main__":
    main()
