# Cognos design system

`@cognos/ui` is the framework-independent source of truth for visual tokens. Angular components live
in [`@cognos/ui-angular`](../ui-angular/COMPONENTS.md); product-specific copy and behaviour stay in
the consuming application.

## Sources

| File                                       | Owns                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`tokens.json`](./tokens.json)             | Machine-readable foundation and semantic token definitions                         |
| [`styles/tokens.css`](./styles/tokens.css) | Typography, spacing, radius, motion, stroke and other foundation custom properties |
| [`styles/themes.css`](./styles/themes.css) | Light/dark semantic colour and shadow custom properties                            |

If these files disagree, fix them together. Product code consumes `--cog-*` custom properties; it
must not copy the raw values from `tokens.json`.

## Use tokens by intent

- Typography: `--cog-fs-*`, `--cog-lh-*`, `--cog-fw-*`, `--cog-ls-*`
- Spacing: `--cog-space-*`
- Radius: `--cog-radius-*`
- Motion: `--cog-dur-*` with `--cog-ease-standard`
- Surfaces and text: `--cog-surface-*`, `--cog-text*`, `--cog-border*`
- Actions and state: `--cog-brand*`, `--cog-selected-*`, `--cog-success-*`,
  `--cog-warning-*`, `--cog-danger-*`, `--cog-info-*`
- Elevation: `--cog-shadow-*` and `--cog-scrim`

Use semantic colour tokens in components. Foundation colours belong only in theme definitions.

```css
.settings-card {
  padding: var(--cog-space-200);
  color: var(--cog-text);
  background: var(--cog-surface);
  border: var(--cog-border-width) solid var(--cog-border);
  border-radius: var(--cog-radius-md);
}
```

## Themes

Themes are selected with attributes on the document element:

```html
<html data-theme="dark" data-accent="emerald"></html>
```

Supported themes are `light` and `dark`. Supported accents are defined in `styles/themes.css`.
Components must respond only through tokens and must not branch on a theme name.

## Add or change a token

1. Search for an existing token with the same intent.
2. Add the machine-readable value and CSS custom property together.
3. Define every semantic colour for every supported theme/accent combination.
4. Replace the concrete consumer in the same change; do not add unused speculative tokens.
5. Check light, dark, high zoom, forced colours and visible focus states.

Do not encode product claims such as “encrypted” into a visual primitive. The consuming app owns
the translated, security-reviewed copy and accessible name.
