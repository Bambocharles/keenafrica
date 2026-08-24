#!/usr/bin/env python3
"""
Keen Africa: delete a social post.

Deletes a published Facebook Page post and/or Instagram media item via
the Meta Graph API. Meant to be run via
.github/workflows/delete-social-post.yml, not directly.

Required environment variable:
  META_PAGE_ACCESS_TOKEN  Long-lived Page access token (also authorizes
                           deleting Instagram media on the linked account)

At least one of these must be set:
  FACEBOOK_POST_ID    Facebook post id to delete
  INSTAGRAM_MEDIA_ID   Instagram media id to delete
"""

import os

import requests

GRAPH_API = "https://graph.facebook.com/v20.0"


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def delete(node_id: str, token: str) -> None:
    resp = requests.delete(f"{GRAPH_API}/{node_id}", data={"access_token": token}, timeout=30)
    if not resp.ok:
        print(f"  FAILED: {resp.text}")
        resp.raise_for_status()
    print(f"  {node_id}: {resp.json()}")


def main() -> None:
    token = env("META_PAGE_ACCESS_TOKEN")
    fb_id = os.environ.get("FACEBOOK_POST_ID")
    ig_id = os.environ.get("INSTAGRAM_MEDIA_ID")

    if not fb_id and not ig_id:
        raise SystemExit("Set FACEBOOK_POST_ID and/or INSTAGRAM_MEDIA_ID.")

    if fb_id:
        print(f"Deleting Facebook post {fb_id}...")
        delete(fb_id, token)

    if ig_id:
        print(f"Deleting Instagram media {ig_id}...")
        delete(ig_id, token)


if __name__ == "__main__":
    main()
