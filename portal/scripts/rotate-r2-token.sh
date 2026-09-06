#!/usr/bin/env bash
# Rotate the Cloudflare R2 API token used by the portal's Asset/File service.
#
# Session 45, item 6. The current token was created in Session 32 and its
# Access Key ID / Secret Access Key were pasted into a chat interface twice
# during setup, which is why it needs replacing. This script exists so the
# new values never reach a chat interface, a shell history file, or a
# process list:
#   - it reads them with `read -s` (no echo, no history)
#   - it hands them to kubectl through a 0600 temp file, never on the
#     command line (argv is world-readable via `ps`)
#   - it shreds that file on exit, including on error or Ctrl-C
#
# Run this yourself, on keenafrica-infra. Do not paste the values anywhere.
#
#   bash ~/rotate-r2-token.sh
#
set -euo pipefail

NS=keen-prod
SECRET=portal-secrets
DEPLOY=portal
BUCKET=keenafrica-portal-assets-prod
# A published article cover served out of R2 — the read-path canary.
CANARY_URL="https://keenafricans.keenafrica.com/covers/0048d5db-f208-43de-9580-9a039843fa8a"
CANARY_BYTES=102959

umask 077

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v kubectl >/dev/null || die "kubectl not found"
command -v jq >/dev/null      || die "jq not found"

# --- 0. Baseline the read path BEFORE changing anything ------------------
# If this is already failing, the rotation is not what needs fixing, and
# proceeding would make the diagnosis harder.
say "Checking the current read path (baseline, before any change)"
base_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$CANARY_URL")
base_size=$(curl -s -o /dev/null -w '%{size_download}' --max-time 20 "$CANARY_URL")
echo "    HTTP $base_code, ${base_size} bytes (expected 200, ${CANARY_BYTES})"
[ "$base_code" = "200" ] || die "R2 reads are ALREADY failing before rotation. Fix that first."

# --- 1. Back up the current secret --------------------------------------
# Cloudflare shows an R2 secret access key exactly once, at creation. If the
# new token turns out to be wrong, the ONLY copy of the old one is the
# running k8s Secret — so capture it before overwriting.
BACKUP="$HOME/portal-secrets-backup-$(date -u +%Y%m%dT%H%M%SZ).yaml"
say "Backing up the current Secret to $BACKUP"
kubectl get secret "$SECRET" -n "$NS" -o yaml > "$BACKUP"
chmod 600 "$BACKUP"
echo "    This file contains EVERY production secret in base64. Delete it once"
echo "    the rotation is verified:  shred -u '$BACKUP'"

# --- 2. Read the new credentials ----------------------------------------
say "Paste the new R2 credentials (input is hidden)"
read -rsp "  New Access Key ID:     " NEW_ID;     echo
read -rsp "  New Secret Access Key: " NEW_SECRET; echo

# Cloudflare R2 access key ids are 32 hex chars; secrets are 64. Checked
# loosely so a future format change doesn't hard-block a real rotation, but
# tight enough to catch the common mistakes: a truncated paste, or pasting
# the *token value* from the generic Cloudflare API token screen instead of
# the S3 credentials from the R2 screen.
[ "${#NEW_ID}" -ge 20 ]     || die "Access Key ID is only ${#NEW_ID} chars — that looks truncated, or it's not an R2 S3 credential."
[ "${#NEW_SECRET}" -ge 40 ] || die "Secret Access Key is only ${#NEW_SECRET} chars — that looks truncated, or it's not an R2 S3 credential."
[ "$NEW_ID" != "$NEW_SECRET" ] || die "You pasted the same value twice."

# --- 3. Patch, without the values ever hitting argv ----------------------
PATCHFILE=$(mktemp)
chmod 600 "$PATCHFILE"
cleanup() { shred -u "$PATCHFILE" 2>/dev/null || rm -f "$PATCHFILE"; }
trap cleanup EXIT INT TERM

jq -n --arg id "$NEW_ID" --arg sec "$NEW_SECRET" \
  '{stringData:{S3_ACCESS_KEY_ID:$id,S3_SECRET_ACCESS_KEY:$sec}}' > "$PATCHFILE"

say "Patching Secret/$SECRET in namespace $NS"
kubectl patch secret "$SECRET" -n "$NS" --type merge --patch-file "$PATCHFILE"

# --- 4. Restart so the pods actually pick it up --------------------------
# portal-prod.yaml uses `envFrom: secretRef`, which is read at container
# start only — patching the Secret alone changes nothing for running pods.
say "Restarting deployment/$DEPLOY (envFrom is read at container start)"
kubectl rollout restart -n "$NS" "deployment/$DEPLOY"
kubectl rollout status  -n "$NS" "deployment/$DEPLOY" --timeout=180s

# --- 5. Verify the read path against the NEW credentials -----------------
say "Verifying R2 reads with the new credentials (6 requests across both pods)"
fail=0
for i in $(seq 1 6); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$CANARY_URL")
  size=$(curl -s -o /dev/null -w '%{size_download}' --max-time 20 "$CANARY_URL")
  printf '    %d/6  HTTP %s  %s bytes\n' "$i" "$code" "$size"
  { [ "$code" = "200" ] && [ "$size" = "$CANARY_BYTES" ]; } || fail=1
done

echo
if [ "$fail" -ne 0 ]; then
  cat <<ROLLBACK
VERIFICATION FAILED. R2 reads are not working with the new credentials.

Roll back with the backup taken in step 1:

    kubectl apply -f "$BACKUP"
    kubectl rollout restart -n $NS deployment/$DEPLOY
    kubectl rollout status  -n $NS deployment/$DEPLOY

Then check: is the new token scoped **Object Read & Write** on **$BUCKET**?
A token scoped to the wrong bucket, or read-only, fails exactly like this.

Do NOT delete the old token in Cloudflare — you may still need it.
ROLLBACK
  exit 1
fi

cat <<DONE

READ PATH VERIFIED — 6/6 HTTP 200, ${CANARY_BYTES} bytes each.

Two things left, in this order:

  1. WRITES. Reads and writes use the same credential, but only a real
     upload proves the Write half of "Object Read & Write" was granted.
     Log into the teacher portal and upload a file to a course resource.
     If it succeeds, writes are good.

  2. ONLY THEN, revoke the old token in the Cloudflare dashboard
     (R2 -> API -> Manage API tokens -> the older one -> Delete), and
     shred the backup:

         shred -u "$BACKUP"

Until you have done step 1, keep the old token alive — it is your only way back.
DONE
