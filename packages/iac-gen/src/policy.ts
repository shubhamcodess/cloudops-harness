import type { Requirements } from "@smc/contracts";
import { file } from "./util.js";

const allowedRegions = (r: Requirements): string[] => {
  switch (r.dataResidency) {
    case "eu":
      return ["eu-west-1", "eu-west-2", "eu-central-1", "europe-west1", "europe-west3"];
    case "us":
      return ["us-east-1", "us-east-2", "us-west-2", "us-central1"];
    case "uk":
      return ["eu-west-2"];
    case "in":
      return ["ap-south-1", "asia-south1"];
    default:
      return [];
  }
};

const requiredTags = ["app", "cost-center", "data-classification", "env"];

const arr = (items: string[]) => "[" + items.map((s) => `"${s}"`).join(", ") + "]";

export const policy = (app: string, reqs: Requirements) => {
  const regions = allowedRegions(reqs);
  const regionRule = regions.length
    ? `allowed_regions := ${arr(regions)}

deny contains msg if {
  input.configuration.provider_config.aws
  region := input.configuration.provider_config.aws.expressions.region.constant_value
  not region_in(region)
  msg := sprintf("aws region %v not in allowed set for data residency", [region])
}

deny contains msg if {
  input.configuration.provider_config.google
  region := input.configuration.provider_config.google.expressions.region.constant_value
  not region_in(region)
  msg := sprintf("gcp region %v not in allowed set for data residency", [region])
}

region_in(r) if {
  some i
  allowed_regions[i] == r
}
`
    : `# data residency: none — no region restriction\n`;

  const rego = `package smc.iac

import rego.v1

# --- no public buckets -------------------------------------------------------
deny contains msg if {
  some r in input.resource_changes
  r.type == "aws_s3_bucket_public_access_block"
  not r.change.after.block_public_acls
  msg := sprintf("s3 bucket %v allows public acls", [r.address])
}

deny contains msg if {
  some r in input.resource_changes
  r.type == "aws_s3_bucket_public_access_block"
  not r.change.after.restrict_public_buckets
  msg := sprintf("s3 bucket %v does not restrict public buckets", [r.address])
}

deny contains msg if {
  some r in input.resource_changes
  r.type == "google_storage_bucket"
  r.change.after.public_access_prevention != "enforced"
  msg := sprintf("gcs bucket %v public access not enforced", [r.address])
}

# --- encryption required -----------------------------------------------------
deny contains msg if {
  some r in input.resource_changes
  r.type == "aws_db_instance"
  not r.change.after.storage_encrypted
  msg := sprintf("rds %v is not encrypted at rest", [r.address])
}

deny contains msg if {
  some r in input.resource_changes
  r.type == "aws_ecr_repository"
  cfg := r.change.after.encryption_configuration[_]
  cfg.encryption_type != "AES256"
  cfg.encryption_type != "KMS"
  msg := sprintf("ecr %v is not encrypted", [r.address])
}

# --- required tags -----------------------------------------------------------
required_tags := ${arr(requiredTags)}

deny contains msg if {
  some r in input.resource_changes
  startswith(r.type, "aws_")
  has_tags_field(r.type)
  some tag in required_tags
  not r.change.after.tags[tag]
  msg := sprintf("resource %v missing required tag %v", [r.address, tag])
}

has_tags_field(t) if {
  taggable := {"aws_s3_bucket", "aws_db_instance", "aws_ecs_cluster", "aws_ecs_service", "aws_ecr_repository", "aws_lb", "aws_lb_target_group", "aws_lambda_function", "aws_secretsmanager_secret"}
  taggable[t]
}

# --- no wildcard iam ---------------------------------------------------------
deny contains msg if {
  some r in input.resource_changes
  r.type in {"aws_iam_policy", "aws_iam_role_policy"}
  doc := json.unmarshal(r.change.after.policy)
  some st in doc.Statement
  st.Effect == "Allow"
  is_wildcard(st.Action)
  msg := sprintf("iam %v uses wildcard action", [r.address])
}

is_wildcard(a) if a == "*"
is_wildcard(a) if {
  is_array(a)
  a[_] == "*"
}

# --- data residency ---------------------------------------------------------
${regionRule}
`;

  const helmRego = `package smc.helm

import rego.v1

deny contains msg if {
  input.kind == "Deployment"
  some c in input.spec.template.spec.containers
  not c.securityContext.readOnlyRootFilesystem
  msg := sprintf("container %v has writable root filesystem", [c.name])
}

deny contains msg if {
  input.kind == "Deployment"
  input.spec.template.spec.securityContext.runAsNonRoot != true
  msg := "pod not runAsNonRoot"
}

deny contains msg if {
  input.kind == "Service"
  input.spec.type == "LoadBalancer"
  msg := "LoadBalancer service exposes pods publicly; use Ingress instead"
}
`;

  return [
    file("policy/iac.rego", rego, "policy"),
    file("policy/helm.rego", helmRego, "policy"),
  ];
};
