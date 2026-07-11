# Product analytics dashboard verification

Plausible provisioning is an external operation. This checklist verifies that the two production
sites match the event registry in [the analytics spec](../specs/product-analytics.md); its presence
does not claim that provisioning has happened.

## Provisioning

- [ ] Create separate sites for `cognos.io` and `app.cognos.io` in the approved EU-hosted account.
- [ ] Restrict dashboard access, enable MFA for operators and record the owner/reviewer privately.
- [ ] Create goals for every event in spec §7 on the correct site.
- [ ] Create funnels: marketing pageview → `cta_click`; `signup_completed` → `message_sent`; and
      `trial_exhausted` → `checkout_started` → `checkout_completed`.
- [ ] Confirm the production CSP permits only the documented marketing script and app Events API.

## Production verification

Use synthetic Accounts and test billing only. Inspect browser requests and the Plausible live view.

- [ ] DNT and GPC each suppress all marketing and app events.
- [ ] Marketing emits pageviews, `cta_click` and `locale_switched` with catalogue enum properties.
- [ ] App pageviews contain route patterns, never record IDs, share tokens or query strings.
- [ ] App events contain no email, Account/Paddle/Conversation IDs, filenames, Message content,
      prompts, key material or error payloads.
- [ ] Signup `ref` values outside the allowlist become `other`; no cross-site visitor identifier is
      created.
- [ ] Funnel steps populate on the correct site. Paddle totals remain the billing source of truth.
- [ ] Save a dated, access-controlled screenshot/export and reviewer sign-off; do not add private
      production data to this repository.

## Baseline record

For the first four weeks, record weekly aggregate K1–K3 values from spec §9 without setting targets.
After week four, write the baseline ranges, sample limitations and the first decision each metric
changed. Small cookieless aggregates are directional, not per-Account conversion rates.

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
