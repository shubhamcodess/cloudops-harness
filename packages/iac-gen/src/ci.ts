import type { Candidate } from "@smc/contracts";
import { file } from "./util.js";

export const ci = (app: string, candidate: Candidate) => {
  const provider = candidate.provider;
  const tfDir = `terraform/${provider}-${candidate.architecture.replace(/^(aws|gcp)-/, "")}`;
  const cloudLogin =
    provider === "aws"
      ? `      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${candidate.region}`
      : `      - name: Auth to Google Cloud (OIDC)
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ vars.GCP_WORKLOAD_IDP }}
          service_account: \${{ vars.GCP_DEPLOY_SA }}`;

  const content = `name: deploy
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  id-token: write
  contents: read
  pull-requests: write

concurrency:
  group: deploy-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install
        run: npm ci || true
      - name: Test
        run: npm test --if-present
      - name: Lint
        run: npm run lint --if-present

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Trivy scan
        uses: aquasecurity/trivy-action@0.28.0
        with:
          scan-type: "fs"
          exit-code: "1"
          severity: "CRITICAL,HIGH"
      - name: Build image
        run: docker build -t ${app}:\${{ github.sha }} .

  plan:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
${cloudLogin}
      - name: Setup OpenTofu
        uses: opentofu/setup-opentofu@v1
      - name: Tofu init
        working-directory: ${tfDir}
        run: tofu init -backend=false
      - name: Tofu plan
        working-directory: ${tfDir}
        run: tofu plan -var-file=floci.tfvars -input=false -no-color

  apply:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    needs: build
    environment: production
    steps:
      - uses: actions/checkout@v4
${cloudLogin}
      - name: Setup OpenTofu
        uses: opentofu/setup-opentofu@v1
      - name: Tofu init
        working-directory: ${tfDir}
        run: tofu init -backend=false
      - name: Tofu apply
        working-directory: ${tfDir}
        run: tofu apply -auto-approve -var-file=floci.tfvars -input=false
`;

  return [file(".github/workflows/deploy.yml", content, "ci")];
};
