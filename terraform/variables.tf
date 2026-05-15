variable "cloudflare_api_token" {
  description = "Cloudflare API token with DNS + Tunnel edit"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  type = string
}

variable "cloudflare_zone_id" {
  type = string
}

variable "tunnel_id" {
  description = "ID of the existing keenafrica-home tunnel"
  type        = string
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod."
  }
}

variable "subdomain" {
  description = "Subdomain (empty for prod)"
  type        = string
}
