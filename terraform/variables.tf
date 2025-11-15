variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "vpc_id" {
  description = "ID of the existing VPC to deploy into"
  type        = string
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs (must belong to the VPC specified by vpc_id)"
  type        = list(string)
}

variable "app_name" {
  description = "Base name for ECS/ALB resources"
  type        = string
  default     = "api-health-check"
}

variable "container_image" {
  description = "ECR image URI with tag"
  type        = string
}

variable "container_port" {
  description = "Container port to expose"
  type        = number
  default     = 8787
}

variable "task_cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate task memory (MiB)"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of ECS tasks"
  type        = number
  default     = 1
}

variable "environment_vars" {
  description = "Plain environment variables for the container"
  type        = map(string)
  default     = {}
}

variable "secret_env_vars" {
  description = "Secrets Manager ARNs keyed by env var name"
  type        = map(string)
  default     = {}
}

variable "health_check_path" {
  description = "ALB health check path"
  type        = string
  default     = "/.well-known/agent.json"
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID (optional)"
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Record name to map to the ALB (e.g., api.example.com)"
  type        = string
  default     = ""
}

variable "attach_secret_policy" {
  description = "Whether to attach Secrets Manager permissions to the ECS execution role"
  type        = bool
  default     = false
}

variable "secret_arns" {
  description = "List of Secrets Manager ARNs (base + optional wildcard) the ECS tasks can read"
  type        = list(string)
  default     = []
}
