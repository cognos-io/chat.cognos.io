# Cognos marketing site

This Astro application serves the public Cognos website in English, Swiss Standard German, French,
European Spanish, European Portuguese and Italian.

Marketing copy must stay plain-language and privacy-first. Match privacy claims to the
[security model](../docs/security-model.md), use the canonical terms in [CONTEXT.md](../CONTEXT.md),
and keep all six locale catalogues under `src/i18n/locales/` structurally identical.

## Commands

Run these from the repository root:

```sh
just web
pnpm --filter @cognos/web test
pnpm --filter @cognos/web build
pnpm --filter @cognos/web test:e2e
```

Astro prints the local URL when `just web` starts. Production deployment is handled by the
[Bunny uploader](../backend/cmd/bunny-deploy/README.md), not from this directory.
