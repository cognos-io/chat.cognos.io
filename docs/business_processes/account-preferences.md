---
description: Account preferences store encrypted chat defaults such as default Model, default Persona, Redaction mode, memory setting, language and theme
name: account-preferences
---

# Account Preferences

Account preferences are the cross-device defaults that make Cognos feel like the
same workspace after sign-in on another device.

There are two storage classes:

| Class                        | Examples                                               | Storage                           |
| ---------------------------- | ------------------------------------------------------ | --------------------------------- |
| encrypted preferences        | default Model, default Persona, Redaction mode, memory | `user_preferences` encrypted data |
| auth-record display metadata | language, theme, avatar, default retention window      | authenticated Account record      |

The encrypted preference record is owned by the Account and accessed through:

| Method  | Path                                  | Behaviour                    |
| ------- | ------------------------------------- | ---------------------------- |
| `GET`   | `/api/v1/user-preferences`            | Fetch the Account's record   |
| `POST`  | `/api/v1/user-preferences`            | Create the first record      |
| `PATCH` | `/api/v1/user-preferences/{id}`       | Replace encrypted data       |

The frontend decrypts preferences after the [Vault](./vault-session.md) opens.
Unknown or stale ids are ignored safely:

- a deleted default Persona falls back to no Persona
- an unavailable default Model falls back to the first eligible Model
- unsupported preference keys are stripped by the client schema

Privacy-sensitive choices that affect provider routing, especially the
[Privacy tier](./privacy-tier-gating.md), are applied before a Completion can be
sent.
