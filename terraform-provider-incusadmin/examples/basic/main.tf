terraform {
  required_providers {
    incusadmin = {
      source  = "5ok.co/incuscloud/incusadmin"
      version = "~> 0.1"
    }
  }
}

# 推荐通过 INCUSADMIN_ENDPOINT + INCUSADMIN_TOKEN env 提供，避免写入 .tfstate
provider "incusadmin" {
  # endpoint  = "https://vmc.5ok.co"
  # api_token = var.api_token
}

variable "ssh_pub" {
  description = "SSH 公钥（如 ssh-ed25519 AAAA... user@host）"
  type        = string
}

# 1) 查找已存在用户（用户由 OIDC 登录自动创建，TF 只能查询不能创建）
data "incusadmin_user" "alice" {
  email = "alice@example.com"
}

# 2) SSH 公钥（注入到 VM cloud-init）
resource "incusadmin_ssh_key" "alice_laptop" {
  name       = "alice-laptop"
  public_key = var.ssh_pub
}

# 3) 防火墙组
resource "incusadmin_firewall_group" "web_default" {
  slug        = "web-default"
  name        = "Web 默认 (80/443)"
  description = "允许 HTTP / HTTPS"
  rules = [
    {
      direction        = "ingress"
      action           = "allow"
      protocol         = "tcp"
      destination_port = "80"
      source_cidr      = "0.0.0.0/0"
      description      = "HTTP"
      sort_order       = 1
    },
    {
      direction        = "ingress"
      action           = "allow"
      protocol         = "tcp"
      destination_port = "443"
      source_cidr      = "0.0.0.0/0"
      description      = "HTTPS"
      sort_order       = 2
    },
  ]
}

# 4) Floating IP（可选 attach 到 VM）
resource "incusadmin_floating_ip" "web" {
  description = "web public IP"
}

# 5) VM（admin endpoint，跳过订单流；schema 用 cluster 替代 project）
resource "incusadmin_vm" "web" {
  cluster   = "default"
  name      = "tf-web-01"
  cpu       = 2
  memory_mb = 4096
  disk_gb   = 40
  os_image  = "ubuntu-22.04"
}

# datasource: 余额 / 订单 / 发票
data "incusadmin_balance" "self" {}

data "incusadmin_orders" "self" {}

data "incusadmin_invoices" "self" {}

output "balance" { value = data.incusadmin_balance.self.balance }
output "vm_ip"   { value = incusadmin_vm.web.ip }
output "fip"     { value = incusadmin_floating_ip.web.ip }
