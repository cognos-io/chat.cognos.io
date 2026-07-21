# Cognos Angular UI

`@cognos/ui-angular` contains presentational Angular components shared across product surfaces.
Check the [`COMPONENTS.md`](./COMPONENTS.md) catalogue before creating a component in the app, and
extract a new shared pattern when it repeats more than twice.

Shared components must:

- use tokens from [`packages/ui`](../ui/README.md)
- be keyboard-operable with visible focus states
- expose correct semantic HTML and accessible names
- receive translated user-visible strings from the consuming app instead of hard-coding English
- avoid product data fetching and business rules

## Commands

Run from the repository root:

```sh
pnpm --filter @cognos/ui-angular test
pnpm --filter @cognos/ui-angular lint
pnpm --filter @cognos/ui-angular storybook
```
