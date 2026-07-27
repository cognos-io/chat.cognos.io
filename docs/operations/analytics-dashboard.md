# Product analytics dashboard verification

Plausible provisioning is an external operation. This checklist verifies that the two production
sites match the [product analytics process](../business_processes/product-analytics.md); its
presence does not claim that provisioning has happened.

## Provisioning

- [x] Create separate sites for `cognos.io` and `app.cognos.io` in the approved EU-hosted account.
- [x] Restrict dashboard access, enable MFA for operators and record the owner/reviewer privately.
- [x] Create goals for every event in the current event catalogue on the correct site.
- [~] Native Plausible funnels deferred (Business plan). Approximate weekly from goal rates instead:
      marketing pageviews ÷ `cta_click`; `signup_completed` ÷ `message_sent`;
      `trial_exhausted` → `checkout_started` → `checkout_completed`. Revisit if drop-off diagnosis
      is needed.
- [x] Add only `https://plausible.io` to the app CSP `connect-src` and set
      `environment.analytics.enabled` to `true` in the same reviewed release. Marketing uses the
      site-specific Plausible script; the app posts to the Events API (no vendor JS).

## Production verification

Use synthetic Accounts and test billing only. Inspect browser requests and the Plausible live view.

- [ ] DNT and GPC each suppress all marketing and app events.
- [ ] Marketing emits pageviews, `cta_click` and `locale_switched` with catalogue enum properties.
- [ ] App pageviews contain route patterns, never record IDs, share tokens or query strings.
- [ ] App events contain no email, Account/Paddle/Conversation IDs, filenames, Message content,
      prompts, key material or error payloads.
- [ ] Signup `ref` values outside the allowlist become `other`; no cross-site visitor identifier is
      created.
- [ ] Goal rates (deferred-funnel substitutes) are visible on the correct site. Paddle totals remain
      the billing source of truth.
- [ ] Save a dated, access-controlled screenshot/export and reviewer sign-off; do not add private
      production data to this repository.

## Baseline record

For the first four weeks, record weekly aggregate acquisition, first-Message and paid-conversion
counts without setting targets. After week four, write the baseline ranges, sample limitations and
the first decision each metric changed. Small cookieless aggregates are directional, not
per-Account conversion rates.

```markdown
- Verification date (UTC):
- Operator / reviewer:
- Dashboard evidence location:
- Week 1 / 2 / 3 / 4 K1:
- Week 1 / 2 / 3 / 4 K2:
- Week 1 / 2 / 3 / 4 K3 (Paddle cross-check):
- Data-quality deviations:
- First action and owner:
```
