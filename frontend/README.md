# Cognos Angular app

This Angular application owns the Account holder's interactive Cognos experience. It unlocks the
Vault, decrypts stored data in the browser, seals new Message content before persistence and sends
Completion prompts to the API over TLS.

## Before changing UI

1. Check the [shared component catalogue](../packages/ui-angular/COMPONENTS.md).
2. Use the design tokens documented in the [design system](../packages/ui/DESIGN_SYSTEM.md).
3. Add every user-visible and assistive-technology string to all six locale files under
   `src/assets/i18n/`.
4. Keep cryptographic behaviour aligned with the [security model](../docs/security-model.md) and
   relevant [business process](../docs/business_processes/README.md).

## Commands

Run these from the repository root:

```sh
just frontend
pnpm --filter @cognos/chat test
pnpm --filter @cognos/chat lint
pnpm --filter @cognos/chat build
```

`just frontend` serves <https://cognos.local:4200> and expects the API at
<http://localhost:8090>. Use `just dev` when the API and mock Provider are also needed.

Browser journeys live in the root [`e2e/`](../e2e/) suite. App-focused Playwright tests live in
`frontend/e2e/`.

## Main areas

| Path                   | Responsibility                                   |
| ---------------------- | ------------------------------------------------ |
| `src/app/services/`    | API, Vault, encryption and product orchestration |
| `src/app/components/`  | Reusable app-level UI                            |
| `src/app/pages/`       | Routed product surfaces                          |
| `src/app/documents/`   | Browser-only document generation                 |
| `src/app/attachments/` | Attachment processing and encryption             |
| `src/assets/i18n/`     | Six-language application catalogues              |
