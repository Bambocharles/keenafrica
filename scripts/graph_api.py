"""Meta Graph API helpers shared by publish_social_post.py and publish_manual_post.py."""

import time

import requests

GRAPH_API = "https://graph.facebook.com/v20.0"


def post_to_facebook(page_id: str, token: str, image_url: str, caption: str) -> str:
    resp = requests.post(
        f"{GRAPH_API}/{page_id}/photos",
        data={"url": image_url, "caption": caption, "access_token": token},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["id"]


def post_to_instagram(ig_user_id: str, token: str, image_url: str, caption: str) -> str:
    container = requests.post(
        f"{GRAPH_API}/{ig_user_id}/media",
        data={"image_url": image_url, "caption": caption, "access_token": token},
        timeout=30,
    )
    container.raise_for_status()
    creation_id = container.json()["id"]

    # Instagram needs a moment to fetch/process the image before it can publish.
    for _ in range(10):
        status = requests.get(
            f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": token},
            timeout=30,
        ).json()
        if status.get("status_code") == "FINISHED":
            break
        time.sleep(3)

    publish = requests.post(
        f"{GRAPH_API}/{ig_user_id}/media_publish",
        data={"creation_id": creation_id, "access_token": token},
        timeout=30,
    )
    publish.raise_for_status()
    return publish.json()["id"]
