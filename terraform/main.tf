terraform {
  required_version = ">= 1.5.7"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket         = "api-health-check-terraform-state"
    key            = "api-health-check/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "api-health-check-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  app_name = var.app_name
  tags = {
    Project = local.app_name
    Managed = "terraform"
  }
  manage_acm_certificate = var.acm_certificate_arn == "" && var.hosted_zone_id != "" && var.domain_name != ""
  enable_api_health_route = var.domain_name != ""
}

# --- Security groups ---

resource "aws_security_group" "alb" {
  name        = "${local.app_name}-alb-sg"
  description = "Allow HTTP/HTTPS to ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.app_name}-alb-sg" })
}

resource "aws_security_group" "tasks" {
  name        = "${local.app_name}-tasks-sg"
  description = "Allow ALB to reach Fargate traffic"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.app_name}-tasks-sg" })
}

# --- Load Balancer + HTTPS ---

resource "aws_lb" "this" {
  name               = "${local.app_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
  tags               = local.tags
}

resource "aws_lb_target_group" "this" {
  name        = "${local.app_name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"
  health_check {
    path                = var.health_check_path
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200-499"
  }
  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_lb_listener_rule" "http_api_health_check" {
  count        = local.enable_api_health_route ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  condition {
    host_header {
      values = [var.domain_name]
    }
  }

  condition {
    path_pattern {
      values = ["/api-health-check*", "/api-health-check/*"]
    }
  }
}

# Optional HTTPS setup if ACM cert ARN provided
resource "aws_lb_listener" "https" {
  count             = var.acm_certificate_arn != "" || local.manage_acm_certificate ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = var.acm_certificate_arn != "" ? var.acm_certificate_arn : aws_acm_certificate_validation.this[0].certificate_arn

  default_action {
    type = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_lb_listener_rule" "https_api_health_check" {
  count        = local.enable_api_health_route && length(aws_lb_listener.https) > 0 ? 1 : 0
  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  condition {
    host_header {
      values = [var.domain_name]
    }
  }

  condition {
    path_pattern {
      values = ["/api-health-check*", "/api-health-check/*"]
    }
  }
}

# --- ECS + IAM ---

resource "aws_ecs_cluster" "this" {
  name = "${local.app_name}-cluster"
  tags = local.tags
}

resource "aws_iam_role" "task_execution" {
  name = "${local.app_name}-task-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "task_execution_secrets" {
  count = var.attach_secret_policy ? 1 : 0

  name = "${local.app_name}-secrets-access"
  role = aws_iam_role.task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
        Resource = var.secret_arns
      }
    ]
  })
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${local.app_name}-task"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_execution.arn

  container_definitions = jsonencode([
    {
      name      = local.app_name
      image     = var.container_image
      essential = true
      portMappings = [{
        containerPort = var.container_port
        hostPort      = var.container_port
        protocol      = "tcp"
      }]
      environment = [
        for key, value in var.environment_vars : {
          name  = key
          value = value
        }
      ]
      secrets = [
        for key, arn in var.secret_env_vars : {
          name      = key
          valueFrom = arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = local.app_name
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${local.app_name}"
  retention_in_days = 7
  tags              = local.tags
}

resource "aws_ecs_service" "this" {
  name            = "${local.app_name}-svc"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    assign_public_ip = true
    security_groups  = [aws_security_group.tasks.id]
    subnets          = var.public_subnet_ids
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = local.app_name
    container_port   = var.container_port
  }

  tags = local.tags
}

# --- DNS & ACM (optional) ---

data "aws_route53_zone" "this" {
  count = var.hosted_zone_id == "" ? 0 : 1
  zone_id = var.hosted_zone_id
}

resource "aws_acm_certificate" "this" {
  count             = local.manage_acm_certificate ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.tags
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.manage_acm_certificate ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options :
    dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}

  zone_id = data.aws_route53_zone.this[0].id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.value]
}

resource "aws_acm_certificate_validation" "this" {
  count                    = local.manage_acm_certificate ? 1 : 0
  certificate_arn          = aws_acm_certificate.this[0].arn
  validation_record_fqdns  = [for record in aws_route53_record.cert_validation : record.fqdn]
}

resource "aws_route53_record" "alb" {
  count   = var.hosted_zone_id == "" ? 0 : 1
  zone_id = data.aws_route53_zone.this[0].id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
