#!/usr/bin/env bash
#
# Manually mirror Requesty's available Models and their metadata.
#
# The same logic runs automatically in-app (a background job on boot + every
# ~6h). This wrapper is for ad-hoc / CI runs. It invokes the canonical Go
# subcommand so the matching + enrichment + curation guardrails live in exactly
# one place (internal/catalogue/requestysync) and can never drift between a
# script and the app.
#
# It discovers new Models, refreshes Provider-owned metadata, and marks Models
# that vanish from Requesty unavailable (never deleted). Existing local enabled,
# whitelisted, privacy_tier, hosting_*, release-date and display-name overrides
# are preserved.
#
# The availability pass is guarded: if more than 25% of available Requesty
# Models are absent (a likely partial response), it is skipped. Bypass the guard
# for a deliberate cleanup with --force-disable-absent:
#
#   ./scripts/sync-requesty-models.sh
#   ./scripts/sync-requesty-models.sh --force-disable-absent
#
# (For the scheduled in-app job set COGNOS_REQUESTY_FORCE_DISABLE_ABSENT=true.)
# An empty fetch never changes availability, even when forced.
#
# Reads the same config as the API (COGNOS_REQUESTY_API_KEY / COGNOS_REQUESTY_URL
# and configs/api.<env>.yaml). Run from the repo root or anywhere.
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root/backend"

exec go run ./cmd/api sync-requesty-models "$@"
