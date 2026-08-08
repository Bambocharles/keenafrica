locals {
  full_hostname  = var.subdomain == "" ? "keenafrica.com" : "${var.subdomain}.keenafrica.com"
  container_name = "site-${var.environment}"
  content_path   = abspath("${path.module}/../site-content-${var.environment}")
}

resource "docker_network" "web" {
  name = "keenafrica-web"
}

resource "docker_image" "nginx" {
  name = "nginx:alpine"
}

resource "docker_container" "site" {
  name    = local.container_name
  image   = docker_image.nginx.image_id
  restart = "unless-stopped"

  volumes {
    host_path      = local.content_path
    container_path = "/usr/share/nginx/html"
    read_only      = true
  }

  networks_advanced {
    name = docker_network.web.name
  }
}

resource "cloudflare_record" "site" {
  zone_id = var.cloudflare_zone_id
  name    = var.subdomain == "" ? "@" : var.subdomain
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

# Zone-wide: force HTTPS and send HSTS + nosniff on every response.
resource "cloudflare_zone_settings_override" "site" {
  zone_id = var.cloudflare_zone_id
  settings {
    always_use_https = "on"
    security_header {
      enabled            = true
      max_age            = 31536000
      include_subdomains = true
      nosniff            = true
      preload            = true
    }
  }
}

# Zone-wide response headers Cloudflare's zone settings don't cover.
# CSP ships Report-Only first — check browser devtools for violations
# before switching the header name to enforcing.
resource "cloudflare_ruleset" "security_headers" {
  zone_id     = var.cloudflare_zone_id
  name        = "Security response headers"
  description = "Baseline security headers on every response"
  kind        = "zone"
  phase       = "http_response_headers_transform"

  rules {
    action      = "rewrite"
    expression  = "true"
    description = "Set security headers on all responses"

    action_parameters {
      headers {
        name      = "X-Frame-Options"
        operation = "set"
        value     = "DENY"
      }
      headers {
        name      = "Referrer-Policy"
        operation = "set"
        value     = "strict-origin-when-cross-origin"
      }
      headers {
        name      = "Permissions-Policy"
        operation = "set"
        value     = "geolocation=(), microphone=(), camera=()"
      }
      headers {
        name      = "Content-Security-Policy-Report-Only"
        operation = "set"
        value     = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com data:; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      }
    }
  }
}

# Aggressively edge-cache the Learn app's Vite build output. These
# filenames are content-hashed (e.g. index-IPUlyFJf.js), so a new build
# always ships under a new path, there's nothing to invalidate. Cuts
# origin load for the JS bundle to near zero under a traffic burst, since
# every learner downloads the same file once before the app runs
# entirely client-side.
#
# Setup required before `terraform apply` will work for this resource:
#   The cloudflare_api_token needs "Zone > Cache Rules > Edit" added
#   (same token used for DNS/Tunnel/Workers above; as of this writing it
#   doesn't have Cache Rules scope, so apply fails with Authentication
#   error (10000)).
resource "cloudflare_ruleset" "cache_learn_assets" {
  zone_id     = var.cloudflare_zone_id
  name        = "Cache Learn app static assets"
  description = "Long-TTL edge cache for content-hashed /learn/assets/* build output"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    action      = "set_cache_settings"
    expression  = "(http.request.uri.path matches \"^/learn/assets/.*$\")"
    description = "Cache /learn/assets/* at the edge for 30 days"

    action_parameters {
      cache = true
      edge_ttl {
        mode    = "override_origin"
        default = 2592000
      }
      browser_ttl {
        mode    = "override_origin"
        default = 14400
      }
    }
  }
}
