---
date: 2026-07-29
decision_makers:
  - repository owner
status: accepted
superseded_by: null
supersedes: null
---

# 0002. Promote images by dispatching the deployment repository

## Context

After publishing a backend image, this repository used to clone the private deployment repository,
edit its application manifest, force-push a bot branch and open a promotion pull request. That work
lived in a Go command with a provider abstraction for two forge APIs, and it required a token with
contents and pull-request write access to the deployment repository.

Two pressures forced a decision. The same promotion is now wanted for other projects listed in the
same deployment repository, so the logic had to live somewhere reusable. And the manifest schema the
code depends on is owned by the deployment repository, not by this one, so every schema change meant
a coordinated change in a repository that could not see it.

## Decision

This repository dispatches a promotion workflow in the deployment repository and finishes. It sends
the Application name, image tag, image digest and build provenance. It does not clone that
repository, edit its manifest, or open the pull request.

The credential is a fine-grained token granting only `Actions: write` on the deployment repository,
which permits triggering workflow runs and nothing else.

The deployment repository derives the image repository from its own manifest and accepts only the
tag and digest from the payload.

## Consequences

Easier: adding a project costs one workflow step and one secret, with no toolchain, no manifest
knowledge and no write access. Manifest-schema changes stay inside the repository that owns the
schema. A leaked promotion credential can at most move an Application to a different tag of the
image it already runs.

Removed: the in-repo promotion command, both forge provider implementations, nine configuration
variables, and the tailnet join that the deploy job needed to reach a private forge.

Harder: promotion is fire-and-forget. This repository reports success once the dispatch is accepted,
so a promotion that fails afterwards surfaces only in the deployment repository's own workflow run.
Anyone debugging a green build with no promotion pull request has to look in two places.

Constrained: the deployment repository must be reachable over the public GitHub API. If a future
deployment host is private-network only, that connectivity belongs to the promotion workflow there,
not here.

## Revisit when

The deployment repository moves to a forge without a dispatch API or public reachability, or when
promotion needs to block this repository's release pipeline on its outcome rather than fire and
forget.
