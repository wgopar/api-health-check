output "alb_dns_name" {
  value       = aws_lb.this.dns_name
  description = "Public DNS of the Application Load Balancer"
}

output "alb_arn" {
  value       = aws_lb.this.arn
  description = "ARN of the ALB"
}

output "ecs_cluster_id" {
  value       = aws_ecs_cluster.this.id
  description = "ECS cluster ID"
}

output "ecs_service_name" {
  value       = aws_ecs_service.this.name
  description = "ECS service name"
}
