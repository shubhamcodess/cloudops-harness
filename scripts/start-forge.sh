#!/usr/bin/env bash
# Starts TrueForge locally, allowing the local Ollama endpoint (blocked by default).
export OUTBOUND_URL_ALLOWED_HOSTS='["localhost","127.0.0.1"]'
exec npx -y @truefoundry/trueforge@latest
