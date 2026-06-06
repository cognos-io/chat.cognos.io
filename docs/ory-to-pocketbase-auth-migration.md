# Ory to PocketBase auth migration

> Historical note: this document describes the earlier migration away from Ory and includes
> superseded references to the pre-Account Key vault flow. The current security baseline is
> documented in `docs/security-model.md`.

## Why we are doing this

Cognos used to rely on Ory as an external identity provider.

We are moving to PocketBase's built-in `users` authentication because it is:

- simpler to run locally
- self-contained
- cheaper to operate
- easier to reason about during development
- already aligned with how the app stores authorization and record ownership

This is a product-speed decision: ship with the simplest auth that works well for Cognos today.

## Current state

After the auth change in this repo:

- the frontend logs in directly against PocketBase `users`
- Ory is no longer used by the app runtime
- the old email-salted vault flow described below has been superseded by the Account Key model

## Important migration rules

Before changing any users, keep these constraints in mind:

1. **Keep the same PocketBase user record where possible**
   - Do not create a brand new user if the existing PocketBase user already represents that person.
   - Other records reference the PocketBase user id.

2. **Keep the same email address if the user already has encrypted vault data**
   - The vault password hash is salted with the user's email.
   - Changing the email without re-migrating vault material can break keypair decryption.

3. **Prefer adding a password to the existing user record**
   - This preserves the user id and existing data relationships.

## What needs migrating

For each user we need to make sure PocketBase has:

- the existing `users` record
- the correct email address
- a usable password
- optional flags like `verified` if you want to preserve them

If users previously signed in via Ory through PocketBase OAuth/OIDC, many of those user records may
already exist in PocketBase. In that case the migration is mostly about setting a password on the
existing record and validating the email.

## Recommended migration process

### 1. Back up PocketBase data

Before modifying auth records, back up PocketBase data.

At minimum, keep a copy of `pb_data` or your production backup.

## 2. Export or inventory existing users

Create a migration checklist with at least:

- PocketBase user id
- email
- name
- whether the user already exists in PocketBase
- whether the user has encrypted keypair/vault data

If the user already exists in PocketBase, migrate that record in place.

## 3. Verify the existing PocketBase user records

In the PocketBase admin UI, inspect the `users` auth collection.

For each user confirm:

- the record exists
- the email is correct
- the user id is the one referenced by their existing app data

Do **not** replace these records with newly created users unless you are also reassigning all
related records.

## 4. Set a password on each existing user

For each migrated user, add a password to their existing PocketBase auth record.

You can do this from:

- the PocketBase admin UI
- a one-off migration script
- the PocketBase API as an admin

The key point is that the **same user record** should now support PocketBase password login.

## 5. Preserve the email address

If the user already has vault-encrypted data, keep their email unchanged.

Because the vault password hash uses the email as a salt, changing it may prevent the existing
encrypted key material from being decrypted.

If an email must change, treat that as a separate migration involving vault/keypair handling.

## 6. Test login for a migrated user

Test with the PocketBase auth endpoint:

```text
http POST :8090/api/collections/users/auth-with-password \
  identity="user@example.com" \
  password="their-password"
```

Then test in the frontend login screen with the same credentials.

## 7. Verify app data access after login

For each tested user verify that they can still access:

- their conversations
- their participant memberships
- their encrypted key material
- normal app navigation after login

This confirms that the PocketBase user id and email assumptions were preserved.

## 8. Disable old Ory-based auth configuration

Once all users are migrated and validated:

- remove Ory operational config from deployment
- remove any remaining PocketBase OIDC/OAuth provider config that was only there for Ory
- keep PocketBase email/password auth enabled for `users`

## Edge cases

### User exists in Ory but not in PocketBase

Create the PocketBase user record with the correct email and password.

But note: if any existing app data was tied to a different PocketBase user id, you must remap those
relations before the user will see their old data.

### User email needs to change

Do not treat this as a normal auth migration.

Because email is part of the vault password derivation, changing the email may require re-encrypting
or regenerating vault-related data.

### User forgot their password

After migration, use normal PocketBase password reset or an admin-set temporary password flow.

## Suggested rollout

For the smallest-risk rollout:

1. back up PocketBase data
2. migrate one internal test user first
3. verify login and vault access
4. migrate the rest of the users
5. remove Ory config after validation

## Definition of done

The migration is complete when:

- users can log in with PocketBase email/password
- existing user ids are preserved
- existing emails are preserved where vault data depends on them
- users can still access their existing encrypted app data
- Ory is no longer required for development or production auth
