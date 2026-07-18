# Contact form + learn-app feedback widget.
#
# Runs entirely at the Cloudflare edge (never touches the nginx origin),
# intercepting POST /api/contact and POST /api/feedback on every hostname
# in the zone. Sends mail via Resend — see worker/forms.js.
#
# Setup required before `terraform apply` will work end-to-end:
#   1. Add and verify keenafrica.com as a sending domain in Resend
#      (resend.com/domains) — it will give you DNS records to add; add
#      them as cloudflare_record resources here once you have them.
#   2. Create a Resend API key and set it as `resend_api_key` (e.g. in
#      terraform.tfvars, which is gitignored — never commit it).
#   3. The Cloudflare API token in `cloudflare_api_token` needs the
#      "Workers Scripts: Edit" and "Workers Routes: Edit" permissions
#      added (it's currently scoped to DNS + Tunnel edit only).

resource "cloudflare_worker_script" "forms" {
  account_id         = var.cloudflare_account_id
  name               = "keenafrica-forms"
  content            = file("${path.module}/worker/forms.js")
  module             = true
  compatibility_date = "2024-09-23"
}

resource "cloudflare_worker_secret" "resend_api_key" {
  account_id  = var.cloudflare_account_id
  script_name = cloudflare_worker_script.forms.name
  name        = "RESEND_API_KEY"
  secret_text = var.resend_api_key
}

resource "cloudflare_worker_route" "forms_apex" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "keenafrica.com/api/*"
  script_name = cloudflare_worker_script.forms.name
}

resource "cloudflare_worker_route" "forms_subdomains" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "*.keenafrica.com/api/*"
  script_name = cloudflare_worker_script.forms.name
}
