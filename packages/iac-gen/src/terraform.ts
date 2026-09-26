import type { Candidate, RepoProfile, Requirements, SecretsManifest } from "@smc/contracts";
import { file, slug } from "./util.js";

type Ctx = {
  app: string;
  profile: RepoProfile;
  reqs: Requirements;
  candidate: Candidate;
  secrets: SecretsManifest;
};

const tagsHcl = (ctx: Ctx): string => {
  const t = {
    app: ctx.app,
    env: "prod",
    "cost-center": "eng",
    "data-classification": ctx.reqs.dataClasses[0] ?? "none",
  };
  const items = Object.keys(t)
    .sort()
    .map((k) => `    "${k}" = "${t[k as keyof typeof t]}"`)
    .join("\n");
  return `{\n${items}\n  }`;
};

const versionsAws = `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
}
`;

const versionsGcp = `terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.40" }
  }
}
`;

const variablesAws = (ctx: Ctx): string => `variable "region" {
  type    = string
  default = "${ctx.candidate.region}"
}
variable "app" {
  type    = string
  default = "${ctx.app}"
}
variable "image" {
  type    = string
  default = "public.ecr.aws/nginx/nginx:stable"
}
variable "budget_usd" {
  type    = number
  default = ${ctx.reqs.monthlyBudgetUsd ?? 100}
}
variable "budget_email" {
  type    = string
  default = "ops@example.com"
}
`;

const variablesGcp = (ctx: Ctx): string => `variable "region" {
  type    = string
  default = "${ctx.candidate.region}"
}
variable "project_id" {
  type    = string
  default = "example-project"
}
variable "app" {
  type    = string
  default = "${ctx.app}"
}
variable "image" {
  type    = string
  default = "gcr.io/cloudrun/hello"
}
variable "budget_usd" {
  type    = number
  default = ${ctx.reqs.monthlyBudgetUsd ?? 100}
}
`;

const providerAws = `provider "aws" {
  region = var.region
  default_tags {
    tags = local.common_tags
  }
}
`;

const providerGcp = `provider "google" {
  project = var.project_id
  region  = var.region
}
`;

const overrideAws = `# Rename to floci_override.tf to point AWS endpoints at a LocalStack-style emulator.
provider "aws" {
  region                      = var.region
  access_key                  = "test"
  secret_key                  = "test"
  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = false
  endpoints {
    ecr            = "http://localhost:4566"
    ecs            = "http://localhost:4566"
    ec2            = "http://localhost:4566"
    elb            = "http://localhost:4566"
    elbv2          = "http://localhost:4566"
    iam            = "http://localhost:4566"
    logs           = "http://localhost:4566"
    rds            = "http://localhost:4566"
    s3             = "http://localhost:4566"
    secretsmanager = "http://localhost:4566"
    sts            = "http://localhost:4566"
    cloudfront     = "http://localhost:4566"
    budgets        = "http://localhost:4566"
    lambda         = "http://localhost:4566"
    appautoscaling = "http://localhost:4566"
    cloudwatch     = "http://localhost:4566"
  }
}
`;

const overrideGcp = `# Rename to floci_override.tf to use a Cloud Run emulator or local GCS-compatible endpoint.
provider "google" {
  project                     = var.project_id
  region                      = var.region
  access_token                = "test"
  request_timeout             = "10s"
}
`;

const localsBlock = (ctx: Ctx): string => `locals {
  common_tags = ${tagsHcl(ctx)}
}
`;

const secretsAws = (ctx: Ctx): string => {
  const items = ctx.secrets.secrets
    .map(
      (s) => `resource "aws_secretsmanager_secret" "${sanitize(s.name)}" {
  name                    = "\${var.app}/${s.name}"
  recovery_window_in_days = 7
  tags                    = local.common_tags
}
`,
    )
    .join("\n");
  return items || "";
};

const secretsGcp = (ctx: Ctx): string =>
  ctx.secrets.secrets
    .map(
      (s) => `resource "google_secret_manager_secret" "${sanitize(s.name)}" {
  secret_id = "\${var.app}-${s.name}"
  replication {
    auto {}
  }
  labels = local.common_tags
}
`,
    )
    .join("\n");

const rdsBlock = (ctx: Ctx): string => {
  if (!ctx.profile.datastores.includes("postgres")) return "";
  const ingressFrom =
    ctx.candidate.architecture === "aws-ecs-fargate"
      ? `    security_groups = [aws_security_group.svc.id]`
      : `    cidr_blocks     = [data.aws_vpc.default.cidr_block]`;
  return `resource "aws_db_subnet_group" "main" {
  name       = "\${var.app}-db"
  subnet_ids = data.aws_subnets.default.ids
  tags       = local.common_tags
}

resource "aws_security_group" "db" {
  name        = "\${var.app}-db"
  description = "postgres"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
${ingressFrom}
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.common_tags
}

resource "aws_db_instance" "main" {
  identifier              = "\${var.app}-db"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_encrypted       = true
  db_subnet_group_name    = aws_db_subnet_group.main.name
  vpc_security_group_ids  = [aws_security_group.db.id]
  username                = "app"
  manage_master_user_password = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "\${var.app}-db-final"
  backup_retention_period = 7
  publicly_accessible     = false
  deletion_protection     = true
  tags                    = local.common_tags
}
`;
};

const sqlBlockGcp = (ctx: Ctx): string => {
  if (!ctx.profile.datastores.includes("postgres")) return "";
  return `resource "google_sql_database_instance" "main" {
  name             = "\${var.app}-db"
  database_version = "POSTGRES_16"
  region           = var.region
  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
    ip_configuration {
      ipv4_enabled = false
    }
  }
  deletion_protection = true
}
`;
};

const budgetAws = `resource "aws_budgets_budget" "monthly" {
  name         = "\${var.app}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    notification_type          = "ACTUAL"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_email]
  }
}
`;

const budgetGcp = `resource "google_billing_budget" "monthly" {
  billing_account = "000000-000000-000000"
  display_name    = "\${var.app}-monthly"
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.budget_usd)
    }
  }
  threshold_rules {
    threshold_percent = 0.8
  }
  lifecycle {
    ignore_changes = [billing_account]
  }
}
`;

const outputsAws = (arch: string): string => {
  if (arch === "aws-ecs-fargate") return `output "alb_dns" { value = aws_lb.main.dns_name }\n`;
  if (arch === "aws-lambda") return `output "function_url" { value = aws_lambda_function_url.main.function_url }\n`;
  return `output "bucket" { value = aws_s3_bucket.site.bucket }\noutput "cf_domain" { value = aws_cloudfront_distribution.site.domain_name }\n`;
};

const outputsGcp = (arch: string): string =>
  arch === "gcp-cloud-run"
    ? `output "service_url" { value = google_cloud_run_v2_service.main.uri }\n`
    : `output "bucket" { value = google_storage_bucket.site.name }\n`;

const dataAwsVpc = `data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
`;

const ecrCluster = `resource "aws_ecr_repository" "main" {
  name                 = var.app
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/ecs/\${var.app}"
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_ecs_cluster" "main" {
  name = var.app
  tags = local.common_tags
}
`;

const ecsService = (ctx: Ctx): string => {
  const port = ctx.profile.services.find((s) => s.port)?.port ?? 8080;
  const secretArns = ctx.secrets.secrets
    .map((s) => `      { name = "${s.name}", valueFrom = aws_secretsmanager_secret.${sanitize(s.name)}.arn }`)
    .join(",\n");
  return `resource "aws_iam_role" "task_exec" {
  name = "\${var.app}-task-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "task_exec" {
  role       = aws_iam_role.task_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "task" {
  name = "\${var.app}-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_security_group" "svc" {
  name        = "\${var.app}-svc"
  description = "service"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = ${port}
    to_port         = ${port}
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.common_tags
}

resource "aws_security_group" "alb" {
  name        = "\${var.app}-alb"
  description = "alb"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.common_tags
}

resource "aws_lb" "main" {
  name               = "\${var.app}-alb"
  internal           = false
  load_balancer_type = "application"
  subnets            = data.aws_subnets.default.ids
  security_groups    = [aws_security_group.alb.id]
  tags               = local.common_tags
}

resource "aws_lb_target_group" "main" {
  name        = "\${var.app}-tg"
  port        = ${port}
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_vpc.default.id
  health_check {
    path    = "/health"
    matcher = "200-399"
  }
  tags = local.common_tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}

resource "aws_ecs_task_definition" "main" {
  family                   = var.app
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_exec.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([
    {
      name      = var.app
      image     = var.image
      essential = true
      portMappings = [{ containerPort = ${port}, protocol = "tcp" }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.main.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
      secrets = [
${secretArns}
      ]
    }
  ])
  tags = local.common_tags
}

resource "aws_ecs_service" "main" {
  name            = var.app
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = data.aws_subnets.default.ids
    security_groups  = [aws_security_group.svc.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = var.app
    container_port   = ${port}
  }
  tags = local.common_tags
}

resource "aws_appautoscaling_target" "svc" {
  max_capacity       = 6
  min_capacity       = 2
  resource_id        = "service/\${aws_ecs_cluster.main.name}/\${aws_ecs_service.main.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "\${var.app}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.svc.resource_id
  scalable_dimension = aws_appautoscaling_target.svc.scalable_dimension
  service_namespace  = aws_appautoscaling_target.svc.service_namespace
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 60
  }
}
`;
};

const lambdaBlock = (ctx: Ctx): string => `resource "aws_iam_role" "lambda" {
  name = "\${var.app}-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/\${var.app}"
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_lambda_function" "main" {
  function_name = var.app
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = var.image
  memory_size   = 512
  timeout       = 15
  environment {
    variables = {
      APP = var.app
    }
  }
  tracing_config {
    mode = "Active"
  }
  tags = local.common_tags
}

resource "aws_lambda_function_url" "main" {
  function_name      = aws_lambda_function.main.function_name
  authorization_type = "NONE"
}
`;

const s3CfBlock = `resource "aws_s3_bucket" "site" {
  bucket        = "\${var.app}-site"
  force_destroy = true
  tags          = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "\${var.app}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }
  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  tags = local.common_tags
}
`;

const cloudRunBlock = (ctx: Ctx): string => {
  const envSecrets = ctx.secrets.secrets
    .map(
      (s) => `      env {
        name = "${s.name}"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.${sanitize(s.name)}.secret_id
            version = "latest"
          }
        }
      }`,
    )
    .join("\n");
  return `resource "google_service_account" "svc" {
  account_id   = "\${var.app}-sa"
  display_name = "\${var.app} runner"
}

resource "google_cloud_run_v2_service" "main" {
  name     = var.app
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account = google_service_account.svc.email
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    containers {
      image = var.image
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
${envSecrets}
    }
  }
  labels = local.common_tags
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  name     = google_cloud_run_v2_service.main.name
  location = google_cloud_run_v2_service.main.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`;
};

const gcsCdnBlock = `resource "google_storage_bucket" "site" {
  name                        = "\${var.app}-site"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  encryption {
    default_kms_key_name = ""
  }
  labels = local.common_tags
  lifecycle {
    ignore_changes = [encryption]
  }
}
`;

const sanitize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_");

export const terraform = (ctx: Ctx) => {
  const files: { path: string; content: string }[] = [];
  const dir = `terraform/${ctx.candidate.provider}-${archSlug(ctx.candidate.architecture)}`;
  const isAws = ctx.candidate.provider === "aws";
  const main = [
    isAws ? dataAwsVpc : "",
    isAws
      ? ctx.candidate.architecture === "aws-ecs-fargate"
        ? ecrCluster + "\n" + ecsService(ctx)
        : ctx.candidate.architecture === "aws-lambda"
        ? lambdaBlock(ctx)
        : s3CfBlock
      : ctx.candidate.architecture === "gcp-cloud-run"
      ? cloudRunBlock(ctx)
      : gcsCdnBlock,
    isAws ? secretsAws(ctx) : secretsGcp(ctx),
    isAws ? rdsBlock(ctx) : sqlBlockGcp(ctx),
    isAws ? budgetAws : budgetGcp,
  ]
    .filter(Boolean)
    .join("\n");

  files.push({ path: `${dir}/versions.tf`, content: isAws ? versionsAws : versionsGcp });
  files.push({ path: `${dir}/providers.tf`, content: (isAws ? providerAws : providerGcp) + "\n" + localsBlock(ctx) });
  files.push({ path: `${dir}/variables.tf`, content: isAws ? variablesAws(ctx) : variablesGcp(ctx) });
  files.push({ path: `${dir}/main.tf`, content: main });
  files.push({ path: `${dir}/outputs.tf`, content: isAws ? outputsAws(ctx.candidate.architecture) : outputsGcp(ctx.candidate.architecture) });
  files.push({
    path: `${dir}/floci.tfvars`,
    content: `region      = "${ctx.candidate.region}"\napp         = "${ctx.app}"\nbudget_usd  = ${ctx.reqs.monthlyBudgetUsd ?? 100}\n`,
  });
  files.push({
    path: `${dir}/floci_override.tf.example`,
    content: isAws ? overrideAws : overrideGcp,
  });

  return files.map((f) => file(f.path, f.content, "terraform"));
};

const archSlug = (a: string): string => a.replace(/^(aws|gcp)-/, "");
