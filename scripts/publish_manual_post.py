#!/usr/bin/env python3
"""
Keen Africa: manual social post.

Posts a single image + caption to the Facebook Page and Instagram
Business account immediately, bypassing the opportunity queue. Meant
to be run via .github/workflows/manual-social-post.yml, not directly.

Required environment variables:
  META_PAGE_ID                 Facebook Page ID
  META_PAGE_ACCESS_TOKEN       Long-lived Page access token
  META_IG_BUSINESS_ACCOUNT_ID  Instagram Business Account ID (linked to the Page)
  IMAGE_URL                    Public URL of the image (must already be live —
                                Instagram fetches by URL, not direct upload)
  CAPTION                      Caption text, posted as-is to both platforms
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from graph_api import post_to_facebook, post_to_instagram  # noqa: E402


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> None:
    page_id = env("META_PAGE_ID")
    page_token = env("META_PAGE_ACCESS_TOKEN")
    ig_user_id = env("META_IG_BUSINESS_ACCOUNT_ID")
    image_url = env("IMAGE_URL")
    caption = env("CAPTION")

    fb_id = post_to_facebook(page_id, page_token, image_url, caption)
    print(f"Facebook post id: {fb_id}")

    ig_id = post_to_instagram(ig_user_id, page_token, image_url, caption)
    print(f"Instagram post id: {ig_id}")


if __name__ == "__main__":
    main()
