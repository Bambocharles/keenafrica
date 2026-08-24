#!/usr/bin/env python3
"""
Keen Africa: read-only social profile check.

Prints the current Facebook Page and Instagram Business account profile
fields (name, about/bio, website, category) for a manual audit against
the brand/mission positioning. Meant to be run via
.github/workflows/check-social-profiles.yml, not directly.

Required environment variables:
  META_PAGE_ID                 Facebook Page ID
  META_PAGE_ACCESS_TOKEN       Long-lived Page access token
  META_IG_BUSINESS_ACCOUNT_ID  Instagram Business Account ID
"""

import json
import os

import requests

GRAPH_API = "https://graph.facebook.com/v20.0"


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def main() -> None:
    page_id = env("META_PAGE_ID")
    token = env("META_PAGE_ACCESS_TOKEN")
    ig_id = env("META_IG_BUSINESS_ACCOUNT_ID")

    page = requests.get(
        f"{GRAPH_API}/{page_id}",
        params={
            "fields": "name,about,description,mission,category,website,link",
            "access_token": token,
        },
        timeout=30,
    )
    page.raise_for_status()
    print("=== Facebook Page ===")
    print(json.dumps(page.json(), indent=2))

    ig = requests.get(
        f"{GRAPH_API}/{ig_id}",
        params={
            "fields": "username,name,biography,website",
            "access_token": token,
        },
        timeout=30,
    )
    ig.raise_for_status()
    print("\n=== Instagram Business Account ===")
    print(json.dumps(ig.json(), indent=2))


if __name__ == "__main__":
    main()
