# Instagram + Facebook auto-posting

Twice a week (Tuesday and Friday), `prepare-social-post.yml` picks the newest
opportunity that hasn't been shared yet, renders a branded 1080x1080 card
(`generate_card.js`), writes a caption, and opens a PR under `social/queue/`
for you to review.

When you merge that PR, it deploys like any other change (staging, then your
usual prod approval). Once the prod deploy succeeds, `publish-social-post.yml`
fires automatically and posts the same image + caption to both Facebook and
Instagram via the Meta Graph API, then archives the entry to `social/posted/`.

To skip a queued opportunity instead of posting it, just close its PR without
merging — the next scheduled run will consider the next-newest opportunity.

## Manual/one-off posts

To post something outside the opportunity queue (an announcement, event photo,
etc.), use `manual-social-post.yml` instead:

1. Get the image publicly live on keenafrica.com. Easiest way: add the file
   under `public/social/manual/`, commit, and push to main — once it deploys
   (staging, then your usual prod approval), it's reachable at
   `https://keenafrica.com/social/manual/<filename>`.
2. Go to the Actions tab → **Manual social post** → **Run workflow**, and fill
   in the image URL and caption. Or from the CLI:
   ```
   gh workflow run "Manual social post" -f image_url="https://keenafrica.com/social/manual/your-image.png" -f caption="Your caption here"
   ```
3. It posts to both Facebook and Instagram immediately — there's no review
   step, so double-check the URL and caption before running it.

## One-time setup (all on your end — I can't do this part)

You need three secrets in the GitHub repo (**Settings → Secrets and
variables → Actions**): `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`,
`META_IG_BUSINESS_ACCOUNT_ID`.

1. **Facebook Page.** If Keen Africa doesn't have one yet, create it at
   facebook.com/pages/create. Note its **Page ID** (Page → About, or
   `graph.facebook.com/me?fields=id&access_token=...` — see step 4).

2. **Instagram Business account.** Convert the Keen Africa Instagram account
   to a Business (or Creator) account in the Instagram app: Settings →
   Account type. Then link it to the Facebook Page above: Instagram app →
   Settings → Linked accounts → Facebook, or from the Page's Settings →
   Linked Accounts → Instagram.

3. **Meta Developer App.** Go to developers.facebook.com/apps → Create App
   → type "Business". Add the **Facebook Login** and **Instagram Graph API**
   products to it.

4. **Long-lived Page access token.** This is the fiddliest part:
   - In the App's dashboard, go to Tools → Graph API Explorer.
   - Select your app, click "Generate Access Token", and grant these
     permissions when prompted: `pages_show_list`, `pages_read_engagement`,
     `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`.
   - This gives you a **short-lived User token**. Exchange it for a
     long-lived one (~60 days):
     ```
     curl -i -X GET "https://graph.facebook.com/v20.0/oauth/access_token?
       grant_type=fb_exchange_token&
       client_id=<APP_ID>&
       client_secret=<APP_SECRET>&
       fb_exchange_token=<SHORT_LIVED_USER_TOKEN>"
     ```
   - Use that long-lived User token to fetch a **never-expiring Page token**:
     ```
     curl -i -X GET "https://graph.facebook.com/v20.0/me/accounts?access_token=<LONG_LIVED_USER_TOKEN>"
     ```
     This lists your Pages with a `access_token` field next to each — that's
     your `META_PAGE_ACCESS_TOKEN`, and the adjacent `id` is your
     `META_PAGE_ID`. Page tokens generated from a long-lived User token don't
     expire (as long as the app isn't removed and the token isn't revoked).

5. **Instagram Business Account ID.** With the Page token from step 4:
   ```
   curl -i -X GET "https://graph.facebook.com/v20.0/<META_PAGE_ID>?fields=instagram_business_account&access_token=<META_PAGE_ACCESS_TOKEN>"
   ```
   The `id` in the response's `instagram_business_account` object is your
   `META_IG_BUSINESS_ACCOUNT_ID`.

6. Add all three values as GitHub Actions secrets, and you're done — the
   next scheduled run (or a manual "Run workflow" on `prepare-social-post.yml`
   from the Actions tab) will queue the first post.

## Local testing

```
pip install markdown pyyaml requests
npm install --prefix scripts/social
python scripts/prepare_social_post.py   # writes public/social/*.png + social/queue/*.json
```

Publishing (`publish_social_post.py`) needs the three secrets above as env
vars and a real, publicly-deployed image URL — it's meant to run in CI after
a deploy, not locally.
