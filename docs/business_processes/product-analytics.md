---
description: Product analytics uses a closed event catalogue, route patterns and non-identifying properties; browser privacy signals disable emission
name: product-analytics
---

# Product Analytics

Cognos measures aggregate product use without cookies or cross-site Account identifiers. Analytics
must never contain email addresses, Account, Conversation, Paddle or Attachment IDs, filenames,
Message content, prompts, key material, raw URLs or error payloads.

Production emission stays disabled until the
[dashboard verification checklist](../operations/analytics-dashboard.md) passes. Development and
e2e builds never send events to Plausible.

## Hard rules

1. Do Not Track or Global Privacy Control disables marketing and app events.
2. Pageviews use sanitised route patterns such as `/c/:conversationId`, never raw URLs, tokens,
   query strings or record IDs.
3. Event properties come from a per-event allowlist and contain closed enums, booleans or bounded
   catalogue Model IDs. Unknown properties are rejected.
4. Analytics failures never block a product action or throw into application code.
5. Paddle remains the billing source of truth; Plausible counts are directional.

## Event catalogue

Marketing events:

- `cta_click`
- `locale_switched`

Application events:

| Area        | Events                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acquisition | `signup_completed`, `onboarding_step_completed`, `login_completed`, `mfa_enrolled`, `vault_unlock_prompted`, `adoption_milestone`, `import_previewed`, `import_completed` |
| Core use    | `conversation_created`, `message_sent`, `message_failed`, `model_selected`, `attachment_added`, `share_created`, `conversation_duplicated`                                |
| Billing     | `trial_exhausted`, `checkout_started`, `checkout_completed`, `plan_changed`, `billing_portal_opened`                                                                      |

The exact property allowlist is `EVENT_PROPS` in
`frontend/src/app/services/analytics/prop-guard.ts`. Adding or renaming an event requires the type,
allowlist, tests, this table and production dashboard goal to change together.

## Dashboard baseline

Provision separate `cognos.io` and `app.cognos.io` sites. Create goals for every event and these
funnels:

- marketing pageview → `cta_click`
- `signup_completed` → `message_sent`
- `trial_exhausted` → `checkout_started` → `checkout_completed`

Record four weeks of aggregate baseline data before setting targets. Small cookieless counts are
useful for trends and prioritisation, not precise per-Account conversion claims.

Backend per-Completion usage telemetry is a separate, content-free process; see
[analytics emit](./analytics-emit.md).
