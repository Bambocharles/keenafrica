# Session 32 (Production Object Storage) — the portal's Asset/File
# service (portal/src/lib/storage.ts's S3StorageDriver) needs a real
# shared/persistent backend: `STORAGE_DRIVER=local` writes to whichever
# k8s pod handled the upload, and `k8s/portal-prod.yaml` runs 2 replicas
# with no persistent volume, so a download from the other pod 500s.
#
# Chose Cloudflare R2 (S3-compatible object storage) over a shared
# ReadWriteMany PVC:
#   - This infra is self-managed Docker/VM hosts running a single-node k3s
#     cluster (see docs/QA_LIVE_TEST_ACCOUNTS.md) — no managed-cloud CSI
#     driver providing a tested RWX volume story. Standing up NFS (or
#     similar) ourselves is genuinely new infrastructure with its own
#     failure modes (a single point of failure this platform doesn't have
#     today), not a shortcut.
#   - Cloudflare is already this domain's DNS/edge/tunnel provider (see
#     `providers.tf`/`main.tf`) — one fewer vendor relationship, and R2
#     has zero egress fees (relevant once Resources/Sponsor documents/
#     Certificates/Messaging attachments are real production traffic).
#   - R2's S3-compatible API means `src/lib/storage.ts`'s driver is a
#     generic S3StorageDriver, not an R2-specific one — the same
#     vendor-neutrality PLATFORM_ARCHITECTURE.md §11 already required of
#     the abstraction, satisfied one level further down.
#
# What Terraform does NOT manage here: the R2 API token (S3 Access Key
# ID / Secret Access Key) used to authenticate against this bucket. The
# `cloudflare` provider (v4.52 here) has no resource for creating R2 API
# tokens/credentials — only `cloudflare_r2_bucket` itself (confirmed via
# the provider's own schema; Cloudflare's own docs note their Terraform
# provider "can only manage buckets" for R2). Deriving S3 credentials from
# a generic `cloudflare_api_token` resource is a documented but separately
# reported-flaky path (cloudflare/terraform-provider-cloudflare#6626) and
# would need an "API Tokens: Edit" grant on the shared automation token —
# broader than this needs. Created instead via the R2 dashboard's own
# "Manage R2 API Tokens" flow, scoped to Object Read & Write on just this
# bucket, and written directly to the `portal-secrets` k8s Secret — never
# to Terraform state, git, or any file/doc, per this session's rules.
resource "cloudflare_r2_bucket" "portal_assets" {
  account_id = var.cloudflare_account_id
  name       = "keenafrica-portal-assets-${var.environment}"
}

output "portal_assets_bucket_name" {
  value = cloudflare_r2_bucket.portal_assets.name
}

# R2's S3-compatible endpoint is account-scoped, not bucket- or
# zone-scoped — this is the value portal/docs/ENVIRONMENT.md's S3_ENDPOINT
# expects (with the bucket name appended as a path segment by the driver
# itself, not included here).
output "portal_assets_s3_endpoint" {
  value = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
}
