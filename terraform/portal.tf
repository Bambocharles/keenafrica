# Wildcard DNS for the sponsor-portal app (see /portal). One record per
# environment workspace, same pattern as cloudflare_record.site in main.tf —
# proxied through the existing tunnel, so TLS is handled by Cloudflare
# Universal SSL automatically (no cert-manager involved).
#
# The Cloudflare Tunnel's hostname->origin routing for this wildcard still
# needs a one-time manual entry in the Zero Trust dashboard (Public Hostname
# tab) pointed at the same origin the existing dev/staging/prod entries use
# — that step can't be expressed in Terraform for this tunnel setup.

locals {
  portal_wildcard_name = var.subdomain == "" ? "*" : "*.${var.subdomain}"
}

resource "cloudflare_record" "portal_wildcard" {
  zone_id = var.cloudflare_zone_id
  name    = local.portal_wildcard_name
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}
