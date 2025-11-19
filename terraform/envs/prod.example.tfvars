app_name        = "api-health-check"
aws_region      = "us-west-2"
vpc_id          = "vpc-0123456789abcdef0"
public_subnet_ids = [
  "subnet-0123456789abc001",
  "subnet-0123456789abc002",
]
container_image = "123456789012.dkr.ecr.us-west-2.amazonaws.com/api-health-check:example-tag"
desired_count   = 1

environment_vars = {
  AGENT_BILLING_ENABLED = "true"
  DEFAULT_PRICE         = "0.001"
  AGENT_DOMAIN          = "health.example.com"
  CHAIN_ID              = "8453" # Base mainnet
  RPC_URL               = "https://mainnet.base.example.org"
  NETWORK               = "base"
  REGISTER_IDENTITY     = "true"
  FACILITATOR_URL       = "https://facilitator.example.com"
}

secret_env_vars = {
  PRIVATE_KEY = "arn:aws:secretsmanager:us-west-2:123456789012:secret:api-health-check-example:PRIVATE_KEY::"
  PAY_TO      = "arn:aws:secretsmanager:us-west-2:123456789012:secret:api-health-check-example:PAY_TO::"
}

attach_secret_policy = true
secret_arns = [
  "arn:aws:secretsmanager:us-west-2:123456789012:secret:api-health-check-example",
  "arn:aws:secretsmanager:us-west-2:123456789012:secret:api-health-check-example:*",
]

hosted_zone_id = "Z0EXAMPLE123456"
domain_name    = "health.example.com"
