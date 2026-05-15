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
