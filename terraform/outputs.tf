output "url" { value = "https://${local.full_hostname}" }
output "container" { value = docker_container.site.name }
