# Cognos design system

This package owns the framework-independent `--cog-*` design tokens and base styles used by the
Angular application, shared component library and marketing site.

Read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) before adding or changing a token. Tokens are defined
in `tokens.json` and emitted through the styles under `styles/`; product code should consume tokens
instead of hard-coded colour, spacing, typography, radius, shadow or motion values.
