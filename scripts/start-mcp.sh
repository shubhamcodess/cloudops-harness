#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx tsx --tsconfig tsconfig.base.json packages/mcp/src/main.ts "$@"
