#!/usr/bin/env bash
#
# Manually run the Requesty model enrichment (reasoning / pricing / context).
#
# The same logic runs automatically in-app (a background job on boot + every
# ~6h). This wrapper is for ad-hoc / CI runs. It invokes the canonical Go
# subcommand so the matching + enrichment + curation guardrails live in exactly
# one place (internal/catalogue/requestysync) and can never drift between a
# script and the app.
#
# It is enrich-only: it updates reasoning_efforts, default_reasoning_effort,
# pricing and context window on matched models, and never touches
# enabled / whitelisted / privacy_tier / hosting_* (residency stays curated).
#
# Reads the same config as the API (COGNOS_REQUESTY_API_KEY / COGNOS_REQUESTY_URL
# and configs/api.<env>.yaml). Run from the repo root or anywhere:
#
#   ./scripts/sync-requesty-models.sh
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/backend"

exec go run ./cmd/api sync-requesty-models "$@"
