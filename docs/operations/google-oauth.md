# Google sign-in production setup

Use this checklist after the application is deployed at its final public HTTPS
origin. Client credentials are operations data: never put them in Git, logs,
screenshots, support tickets, or browser code.

## Configure

- [ ] In Google Cloud, create an OAuth client for a **Web application**.
- [ ] Set the authorised redirect URI to the PocketBase callback on the exact
      public application origin:
      `https://<app-origin>/api/oauth2-redirect`.
- [ ] In the PocketBase `users` auth collection, configure the `google`
      provider with that client ID and secret.
- [ ] Keep password authentication enabled. Apple and Microsoft must remain
      disabled until their separate business rules and tests ship.
- [ ] Confirm `display_name` is the only mapped Google profile field. Do not
      map or download the Google profile image.

The frontend asks PocketBase which methods are configured. **Continue with
Google** stays hidden until PocketBase reports an available `google` provider.
No frontend deployment or client secret is needed for that switch.

## Verify before release

Use synthetic company-owned Accounts. Do not capture OAuth codes, tokens,
Account Keys, or real email addresses as evidence.

- [ ] Run the automated Elena journey:
      `pnpm --dir e2e exec playwright test tests/persona-elena.spec.ts`.
- [ ] Create a new Google-only Account and save its Emergency Kit.
- [ ] Log out, sign in again with the same Google identity, and Unlock with the
      Account Key.
- [ ] Try Google with an email already used by a password Account. Confirm that
      Cognos refuses to merge, then connect Google using the password-gated
      Security flow.
- [ ] Close the popup and retry. Confirm there is no partial Account or link.
- [ ] Try a different Google identity during delete confirmation. Confirm that
      deletion is refused.
- [ ] Check production logs contain no OAuth code, access token, Account Key,
      email address, or decrypted Conversation content.

## Rotation and rollback

Changing or disabling Google can lock Google-only Account holders out. Before
rotating credentials, confirm the replacement in a non-production environment,
schedule a production smoke test, and keep a tested rollback value in the
approved secret store.

Do not disable the provider as a routine rollback while Google-only Accounts
exist. If Google sign-in is unsafe or unavailable, treat it as an authentication
incident and follow [incident response](./incident-response.md).

The behavioural source of truth is
[Google OAuth sign-in](../business_processes/oauth-google-sign-in.md).
