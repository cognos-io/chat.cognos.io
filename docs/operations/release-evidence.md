# Release evidence

Every paid-production release must be traceable to a green CI run for the exact commit and immutable
image digest. A local pass is useful diagnostic evidence, but it does not replace this bundle.

## Required bundle

Retain the release workflow run and its artifacts for at least one year:

- commit SHA, tag, workflow run URL, UTC time, declared Go/Node/pnpm versions and dependency
  lockfile hashes;
- Go tests, vet, `govulncheck`, `staticcheck` and `gosec` results with pinned tool versions;
- frontend and shared-library lint, tests and production builds;
- marketing build, analytics build check and accessibility tests;
- both Playwright suites and reports;
- frozen-lockfile dependency audit;
- filesystem/container vulnerability reports and SPDX JSON SBOM;
- backend image digest and the deployment-repository promotion record;
- triage record for every accepted warning or finding, with owner, rationale and expiry date.

The CI workflow is the executable checklist. Release from a tag only after every required job is
green. Download the artifacts or copy their immutable external archive link into the release record;
GitHub artifact retention alone is not a long-term archive unless repository policy guarantees it.

## Release record template

```markdown
# Release evidence — VERSION

- Decision: go | no-go
- Commit SHA:
- Tag:
- CI workflow run:
- Evidence archive:
- Backend image digest:
- Deployment promotion record:
- Operator / reviewer:
- Approved-at (UTC):

## Findings accepted for this release

- Finding, rationale, owner, expiry:

## Smoke tests

- Readiness:
- Synthetic authentication and cross-Account denial:
- Encrypted Message storage and mock Completion:
- Billing test-mode identity:
- Analytics content/identifier inspection:

## Rollback target

- Previous known-good image digest:
- Schema compatibility confirmed by:
```

Never copy secrets, Account data or Message content into release artifacts.
