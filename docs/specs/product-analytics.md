# Product Analytics — Privacy-Respecting Event Tracking

**Status:** Implemented — Plausible site setup (dashboard) outstanding
**Scope:** `web/` (marketing site) and `frontend/` (Angular app). No backend changes.
**Stack:** Plausible Analytics (EU-hosted) in production, `console.debug` in development,
behind a swappable interface on both surfaces.

We want to make data-driven product decisions (funnel, activation, feature adoption,
trial→paid conversion) without compromising the one thing Cognos sells: privacy. This spec
defines a tiny event-tracking abstraction for both surfaces, the exact events we capture,
and the hard privacy rules every event must obey.

## 1. Goals

- Understand the marketing funnel: which pages, locales and CTAs actually produce signups.
- Understand activation: how many new Account holders reach their first sent message, and where they
  drop off in onboarding.
- Understand monetisation: trial exhaustion → checkout started → checkout completed, per plan.
- Understand feature adoption (models, attachments, sharing, duplication, MFA) to guide
  roadmap priorities.
- Keep the analytics vendor swappable: Plausible today, anything tomorrow, by changing one
  adapter per surface.
- Zero events sent from development environments (console output only).

## 2. Non-goals

- No session replay, heatmaps, or per-Account holder behavioural profiles.
- No A/B testing framework (revisit later; the interface doesn't preclude it).
- No backend/server-side event emission in v1 (Paddle webhooks already give us the revenue
  source of truth; see §8).
- No shared `packages/analytics` package. The interface is ~30 lines per surface; a shared
  package is not worth the coupling yet.

## 3. Privacy principles (hard rules)

These are non-negotiable and every event in §7 was checked against them. They align with
`docs/security-model.md`.

1. **No identifiers.** No user IDs, emails, Paddle customer IDs, conversation IDs, share
   tokens, or any value that identifies a person or their content. Plausible is cookieless
   and keeps no persistent device ID; we never add one on top.
2. **No content, ever.** Message text, titles, filenames, prompts, personas, search queries
   and key material must never appear in an event name, prop, or URL. Props are
   **enums and booleans only** — never free-form strings (this makes leaks structurally
   impossible, not just forbidden).
3. **Sanitised URLs.** The app never reports raw router URLs. Pageviews use the **route
   pattern** (`/c/:conversationId`, `/p/:token`), never the resolved path. Marketing URLs
   are clean by construction (static pages, no tokens).
4. **No third-party JavaScript in the app.** `frontend/` handles key material; loading a
   vendor script there is an exfiltration risk. The app talks to Plausible's Events API
   with a plain `POST` — no vendor code executes in the app context. The marketing site
   (no secrets) may use the official script tag.
5. **Respect opt-out signals.** If `navigator.doNotTrack === '1'` or
   `navigator.globalPrivacyControl` is set, the tracker becomes a no-op on both surfaces.
6. **EU data residency.** Plausible Cloud is EU-hosted, consistent with our "kept in
   Switzerland or Europe" promise. Self-hosting remains an option behind the same interface.
7. **Aggregate-only funnel stitching.** We never link an individual marketing visitor to an
   Account holder or a Paddle customer. Cross-surface attribution uses a coarse `ref` label (§8).
8. **Disclosed in plain language.** The privacy page must mention analytics before this
   ships (§11), in all six locales, following the no-jargon marketing rules.

## 4. Architecture overview

Both surfaces implement the same conceptual interface:

```ts
type EventProps = Record<string, string | number | boolean>;

interface Analytics {
  /** Named product event from the catalogue in §7. */
  track(event: AnalyticsEvent, props?: EventProps): void;
  /** App only: sanitised route-pattern pageview. Marketing pageviews are automatic. */
  page(routePattern: string): void;
}
```

Three implementations exist across the two surfaces:

| Implementation       | Where              | Behaviour                                                                       |
| -------------------- | ------------------ | ------------------------------------------------------------------------------- |
| Console              | dev, both surfaces | `console.debug('[analytics] cta_click', props)` — nothing leaves the machine    |
| Plausible script     | `web/` prod        | official `script.js` tag for pageviews + `window.plausible()` for custom events |
| Plausible Events API | `frontend/` prod   | direct `POST https://plausible.io/api/event`, no vendor JS                      |
| No-op                | tests, opt-out     | swallows everything                                                             |

Two Plausible sites: `cognos.io` and `app.cognos.io`. Keeping them separate keeps marketing
pageview noise out of product dashboards; the funnel is stitched in aggregate (§8).

Event names are `snake_case`. Adding an event means adding it to the catalogue table in
this spec in the same PR — the spec is the registry.

## 5. `web/` implementation (Astro)

### 5.1 Module: `web/src/lib/analytics.ts`

A dependency-free module (matching the existing `src/config.ts` / `src/i18n/ui.ts` style):

```ts
export type WebAnalyticsEvent = 'cta_click' | 'locale_switched';

export function track(event: WebAnalyticsEvent, props?: EventProps): void {
  if (optedOut()) return;
  if (import.meta.env.DEV) {
    console.debug(`[analytics] ${event}`, props ?? {});
    return;
  }
  window.plausible?.(event, { props });
}
```

`import.meta.env.PROD` (build-time) is the dev/prod switch — no env files needed, matching
the site's current zero-config approach.

### 5.2 Script tag in `BaseLayout.astro`

Rendered **only when `import.meta.env.PROD`**, in `<head>` after the meta tags:

```html
<script defer data-domain="cognos.io" src="https://plausible.io/js/script.js"></script>
<script>
  window.plausible =
    window.plausible ||
    function () {
      (window.plausible.q = window.plausible.q || []).push(arguments);
    };
</script>
```

The queue shim lets `track()` fire before the deferred script loads. Pageviews are
automatic; locale is visible in the path (`/de/…`), so language performance needs no extra
prop. Plausible strips all query params except `utm_*` and records no hashes.

### 5.3 Declarative CTA instrumentation

Rather than sprinkling listeners through nine components, CTAs declare their identity and
one delegated listener in the existing `BaseLayout.astro` script handles all of them:

```html
<a
  href="{signUpUrl}"
  data-track="cta_click"
  data-track-location="hero"
  data-track-target="signup"
></a>
```

```ts
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-track]');
  if (!el?.dataset.track) return;
  // Props are built generically from data-track-* attributes:
  // data-track-location → location, data-track-target → target,
  // data-track-to → to. Attributes are authored statically, so the
  // prop set stays a closed enum by construction.
  track(el.dataset.track as WebAnalyticsEvent, propsFromDataset(el.dataset));
});
```

The same listener serves `locale_switched` — the footer language links carry
`data-track="locale_switched" data-track-to={code}`.

`location` values (enum): `navbar`, `hero`, `how_it_works`, `pricing_individuals`,
`pricing_business`, `cta_individuals`, `cta_business`, `redaction`, `about` — live
today (`cta_business` links to the `/business` page with `target: business`, no `ref`).
Reserved but currently unused: `contact` (the contact page converts via mailto links,
untracked in v1) and `footer` (no signup CTA exists there).
`target` values: `signup`, `signin`, `business`.

### 5.4 Signup attribution (`ref`)

The CTA helpers append `?ref=<location>` to `SIGN_UP_URL` (centralised in
`web/src/config.ts` via a `signUpUrl(location)` helper so components stop concatenating
URLs by hand). This is a coarse placement label — never a visitor identifier — and is
consumed by the app in §6.5.

## 6. `frontend/` implementation (Angular)

### 6.1 Injection design

Follow the existing `PADDLE_CONFIG` pattern (`services/paddle.service.ts`): an abstract
class as the DI token, a config token, and a factory that picks the implementation from
`environment`:

```ts
// services/analytics/analytics.ts
export abstract class Analytics {
  abstract track(event: AppAnalyticsEvent, props?: EventProps): void;
  abstract page(routePattern: string): void;
}

export const ANALYTICS_CONFIG = new InjectionToken<AnalyticsConfig>(
  'ANALYTICS_CONFIG',
  {
    providedIn: 'root',
    factory: () => ({
      enabled: environment.analytics.enabled,
      domain: environment.analytics.plausibleDomain, // 'app.cognos.io'
      apiHost: environment.analytics.plausibleApiHost, // 'https://plausible.io'
    }),
  },
);

export function provideAnalytics(): Provider[] {
  return [
    {
      provide: Analytics,
      useClass: environment.analytics.enabled ? PlausibleAnalytics : ConsoleAnalytics,
    },
  ];
}
```

- `provideAnalytics()` goes in `app.config.ts` alongside `providePocketbase()` etc. It
  lives in its own `analytics.providers.ts` (not `analytics.ts`) so `test-providers.ts`
  can import the token without transitively pulling `@angular/router` into the test
  harness bootstrap.
- Tests provide `NoopAnalytics` (or just `ConsoleAnalytics`); swapping vendors later means
  writing one new class implementing `Analytics`.
- Scaffold with `ng generate` per repo convention.

Environment additions (`environment.ts` / `.development.ts` / `.e2e.ts`):

```ts
analytics: {
  enabled: true,            // false in development and e2e
  plausibleDomain: 'app.cognos.io',
  plausibleApiHost: 'https://plausible.io',
},
```

### 6.2 `PlausibleAnalytics` — Events API, no vendor script

```ts
@Injectable()
export class PlausibleAnalytics implements Analytics {
  private readonly _config = inject(ANALYTICS_CONFIG);

  track(event: AppAnalyticsEvent, props?: EventProps): void {
    if (optedOut()) return;
    void fetch(`${this._config.apiHost}/api/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        domain: this._config.domain,
        name: event,
        url: `https://${this._config.domain}${this._currentRoutePattern}`,
        props,
      }),
    }).catch(() => {}); // analytics must never break the app
  }
}
```

Notes:

- `keepalive: true` so events fire during navigation/logout aren't dropped.
- Failures are swallowed silently — analytics is fire-and-forget, never awaited on a hot
  path, never logged with payloads.
- Plausible derives visitor counts from IP + User-Agent with a daily-rotating salt and
  discards the raw IP; nothing persistent lives in the browser.
- `optedOut()` checks DNT/GPC (shared helper with the console impl's early return).

### 6.3 Pageviews with sanitised routes

Plausible's auto-pageviews would record `/c/<real-conversation-id>` and
`/p/<real-share-token>` — forbidden by §3.3. So the app sends **manual** pageviews from a
single subscription to router events (in `app.component.ts` or an `APP_INITIALIZER`-style
provider), reconstructing the **route config pattern** from the activated route snapshot:

```text
/c/abc123xyz            → page('/c/:conversationId')
/p/8f3k...              → page('/p/:token')
/account/projects/p42   → page('/account/projects/:projectId')
```

A unit-tested `routePattern(route: ActivatedRouteSnapshot): string` helper walks
`snapshot.routeConfig.path` segments. Unknown/lazy edge cases fall back to `'/unknown'` —
never the raw URL.

### 6.4 Prop guard (defence in depth)

A dev-mode assertion in the `Analytics` base wiring rejects any prop value that is a
string longer than 32 characters or contains `@`, and any prop key outside the catalogue.
In production the guard silently drops the offending prop. This makes "someone passed the
conversation title into props" a test failure, not a data leak.

Model catalogue ids are the one legitimate value that can trip the `@` rule
(provider-synced ids like `o4-mini@eastus2`), so a `modelProp()` normaliser maps `@` to
`:` and clamps to 32 characters before the guard sees the value — a real id is never
dropped, and the guard stays strict for everything else.

### 6.5 Signup source

`RegisterComponent` reads `?ref=` on arrival, keeps it in memory (component state only —
no storage), and passes it as the `source` prop on `signup_completed`. If absent:
`source: 'direct'`. Values outside the §5.3 enum map to `'other'`.

## 7. Event catalogue

This table is the registry. Adding an event = updating this table in the same PR.
All props are closed enums or booleans (§3.2).

### 7.1 Marketing site (`cognos.io`)

| Event             | Props                         | Decision it informs                                         |
| ----------------- | ----------------------------- | ----------------------------------------------------------- |
| _(pageview)_      | — (automatic; locale in path) | Which pages/locales get traffic; content & i18n investment  |
| `cta_click`       | `location`, `target`          | Which sections and copy actually drive signups; page layout |
| `locale_switched` | `to`                          | Whether the language switcher is used; locale demand        |

### 7.2 App (`app.cognos.io`)

Acquisition & onboarding

| Event                       | Props                                           | Decision it informs                                                          |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `signup_completed`          | `source` (§6.5)                                 | Marketing attribution; visit→signup conversion                               |
| `onboarding_step_completed` | `step`: `email_verified` \| `account_key_saved` | Where onboarding loses people; whether the Account Key step needs UX work    |
| `login_completed`           | `mfa` (bool)                                    | MFA adoption; login friction                                                 |
| `mfa_enrolled`              | —                                               | Security feature adoption                                                    |
| `vault_unlock_prompted`     | `trigger`: `new_session` \| `relocked`          | Quantifies Account-Key re-entry pain without implying an idle timeout exists |

Core usage (activation & retention)

| Event                     | Props                                                                       | Decision it informs                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `conversation_created`    | —                                                                           | Core engagement baseline                                                                                             |
| `message_sent`            | `model`, `attachments` (bool), `reasoning`: `none`\|`low`\|`medium`\|`high` | Activation (signup→first message via funnel); model mix → provider decisions (Infomaniak/Requesty); reasoning demand |
| `message_failed`          | `reason`: `rate_limited` \| `provider_error` \| `balance` \| `other`        | Reliability priorities; which providers hurt UX                                                                      |
| `model_selected`          | `model`                                                                     | Catalogue curation — which models to keep, add, drop                                                                 |
| `attachment_added`        | —                                                                           | Attachments V1 adoption; whether library rework is worth it                                                          |
| `share_created`           | —                                                                           | Public-share adoption                                                                                                |
| `conversation_duplicated` | —                                                                           | Duplicate-chat adoption (v1 scope validation)                                                                        |

Monetisation

| Event                   | Props                                                                          | Decision it informs                                          |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `trial_exhausted`       | —                                                                              | Trial seed sizing (CHF 2); when to prompt upgrade            |
| `checkout_started`      | `plan`: `payg` \| `unlimited`, `entry`: `pricing` \| `trial_lock` \| `billing` | Which prompt converts; plan preference                       |
| `checkout_completed`    | `plan`                                                                         | Trial→paid conversion; confirms Paddle numbers directionally |
| `plan_changed`          | `from`, `to`                                                                   | Up/downgrade patterns; pricing fit                           |
| `billing_portal_opened` | —                                                                              | Self-serve billing health                                    |

**Where to hook them:** each event fires from the service that owns the action, not from
components — `message.service.ts` (`message_sent`/`message_failed`),
`conversation.service.ts`, `model.service.ts`, `auth.service.ts`, `mfa.service.ts`,
`billing.service.ts` + `paddle.service.ts` (`checkoutCompleted$`),
`attachment-upload.service.ts`, `public-share.service.ts`,
`conversation-duplicate.service.ts`, `vault.service.ts`. One `inject(Analytics)` + one
`track()` call per site keeps instrumentation reviewable.

**Note on `vault_unlock_prompted.trigger`:** idle logout is not implemented. A prompt before any
unlock in the current JS session reports `new_session`; a prompt after the vault was locked again in
that session reports `relocked`. The event is deduped per locked period, and the create-backup
onboarding dialog (a new key pair, not an unlock) is excluded. Add a new closed-enum trigger only
when the corresponding product behaviour exists.

**Explicitly not tracked:** message content/length, conversation titles, search queries,
persona contents, redaction hits, error payloads, anything on the public share page beyond
the sanitised pageview.

## 8. Funnel & Paddle — aggregate linking only

The end-to-end funnel is stitched from **counts**, never from individuals:

```text
cognos.io pageview → cta_click {location} → app signup_completed {source=location}
  → message_sent (first activation) → trial_exhausted → checkout_started → checkout_completed
```

- Plausible funnels/goals give each stage per site; the `source` prop carries placement
  attribution across the domain boundary without any identifier.
- **Paddle stays the revenue source of truth.** `checkout_completed` counts should
  approximately match `subscription.created` webhooks; a persistent gap is itself a signal
  (checkout abandonment after Paddle overlay opens, or tracking loss).
- We do **not** send Paddle customer/transaction IDs to Plausible, and we do **not** put
  Plausible data into Paddle `custom_data`. If we later want revenue in dashboards,
  Plausible's revenue-on-custom-events (amount + currency on `checkout_completed`) is
  acceptable — amounts are our data, not the Account holder's — but it's P1.

## 9. KPI registry

This is the canonical list of what we act on and exactly which events feed each number.
Company-of-one rules: a metric only earns a row here if a bad number changes what gets
built next; everything else is noise. Adding a KPI = adding it here in the same PR
(same registry rule as §7).

**North star: paying customers / MRR — read from Paddle, never from Plausible.**
Analytics exist to diagnose the funnel feeding that number, not to restate it.

### 9.1 Weekly funnel KPIs (checked in the Friday review — ~15 minutes)

| #   | KPI            | Formula (aggregate counts)                                                                                                        | Events in                                                                                            | Bad number → do this                                                                                                                                         |
| --- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K1  | Visit → signup | `signup_completed` ÷ `cognos.io` unique visitors; segment by locale (path) and placement                                          | `cognos.io` pageviews + `cta_click {location}`; app `signup_completed {source}`                      | Low overall → landing copy. Low for one locale → that locale's copy. `cta_click` high but signups low → register page                                        |
| K2  | Activation     | Plausible funnel `signup_completed → message_sent` (same-session); cross-check `conversation_created` ÷ `signup_completed` weekly | `signup_completed`, `onboarding_step_completed {step}`, first `message_sent`                         | Drop before `email_verified` → verification mail UX; before `account_key_saved` → Account Key step; after → empty-chat UX                                    |
| K3  | Trial → paid   | `checkout_completed` ÷ `trial_exhausted`; `entry` split on `checkout_started`; started−completed gap                              | `trial_exhausted`, `checkout_started {plan, entry}`, `checkout_completed {plan}` (+ Paddle webhooks) | Few `trial_exhausted` → trial seed too big / no engagement (check K2). Starts without completes → checkout friction. Low `trial_lock` entry → upgrade prompt |

### 9.2 Monthly diagnostics (consulted when deciding the roadmap, not watched weekly)

| #   | Diagnostic           | Formula                                                                          | Events in                                                   | Decision it informs                                                |
| --- | -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| D1  | Account Key friction | `vault_unlock_prompted` ÷ `app.cognos.io` daily visitors; `trigger` split        | `vault_unlock_prompted {trigger}`                           | Whether passkey/PIN quick-unlock is the next UX investment         |
| D2  | Model demand         | `message_sent` distribution by `model`; `reasoning` split                        | `message_sent {model, reasoning}`, `model_selected {model}` | Catalogue curation; Infomaniak/Requesty provider decisions         |
| D3  | Reliability          | `message_failed` ÷ `message_sent`; `reason` split                                | `message_failed {reason}`, `message_sent`                   | Which provider/limit work hurts Account holders most               |
| D4  | Feature pull         | `attachment_added`, `share_created`, `conversation_duplicated` ÷ weekly visitors | those three events                                          | Keep/expand/drop: attachments library rework, sharing, duplication |

### 9.3 Reading rules (honesty about what cookieless aggregates can say)

- Every ratio is a **count ratio**, not a per-user rate: Plausible has no Account holder identity
  (§3.1/§3.7), so "activation" is approximated by the same-session funnel plus the weekly
  count cross-check. Numbers are directional — good enough to rank problems, not to report
  precision percentages.
- Baseline for the first 2–4 weeks before setting any target; act on **trends and splits**
  (locale, `source`, `entry`, `reason`), not week-to-week wobble at small volume.
- Where Paddle and Plausible overlap (K3), Paddle wins; a persistent gap between
  `checkout_completed` and `subscription.created` is itself a K3 signal (§8).

Dashboard setup this implies (the §11 manual step): goals for every §7 event, plus three
funnels — `cognos.io` pageview → `cta_click`; app `signup_completed` → `message_sent`;
app `trial_exhausted` → `checkout_started` → `checkout_completed`.

## 10. Testing

Per repo convention: red/green, tables, e2e for behaviour.

- **Unit (vitest tables):** `routePattern()` sanitiser — sunny (`/c/:conversationId`),
  rainy (unknown route → `/unknown`), edge (nested project routes, public `/p/:token`);
  prop guard — rejects long strings, `@`-containing values, unknown keys; opt-out helper —
  DNT/GPC variants.
- **Unit:** `ConsoleAnalytics` used when `analytics.enabled` is false; `PlausibleAnalytics`
  never throws when `fetch` rejects.
- **e2e (Playwright):** with the app running in the e2e environment, assert **zero network
  requests** to `plausible.io` across a full login → send-message → logout journey (this is
  the "dev/e2e never spams events" guarantee, and would also catch an accidental vendor
  script).
- **Web build check (`web/scripts/check-analytics.mjs`, wired as `pnpm --filter
  @cognos/web test`):** after `astro build`, assert the built homepage carries the
  Plausible tag + queue shim and `data-track` on the key CTAs, and that `plausible.io`
  appears in `web/src/` only in `lib/analytics.ts` and `layouts/BaseLayout.astro`.
  (Dev builds tree-shake the tag out via `import.meta.env.PROD` — verified manually,
  no separate web e2e suite.)
- **Grep guardrail (CI):** no `plausible.io` string outside the adapter files
  (`web/src/lib/analytics.ts`, `web/src/layouts/BaseLayout.astro`, the frontend
  `services/analytics/` module), the frontend `environments/` files (which hold the
  API host), the web check script, the root-suite analytics e2e spec and this spec.

## 11. Rollout checklist

- [ ] Create Plausible sites `cognos.io` and `app.cognos.io`; define and verify the goals + three
      funnels listed at the end of §9.3 using the
      [dashboard verification checklist](../operations/analytics-dashboard.md). This requires
      external dashboard access and is not complete merely because this repository is configured.
- [x] `web/`: `src/lib/analytics.ts`, prod-only script tag in `BaseLayout.astro`, delegated listener
- [x] `web/`: `data-track` attributes on all CTAs (§5.3) + `signUpUrl(location)` helper in
      `config.ts`
- [x] `web/`: privacy page updated in **all six locales** — plain language, e.g. "We use
      privacy-friendly analytics that use no cookies and collect no personal data; visits
      are counted in aggregate on servers in Europe." (no jargon, per marketing rules)
- [x] `frontend/`: `Analytics` abstraction + three impls + `provideAnalytics()` in `app.config.ts`
- [x] `frontend/`: environment `analytics` block (prod on; dev + e2e off)
- [x] `frontend/`: router pageview subscription + `routePattern()` helper
- [x] `frontend/`: instrument §7.2 events in owning services
- [x] `frontend/`: `ref` → `source` plumbing in `RegisterComponent`
- [x] Tests per §10 (incl. the grep guardrail + web build check in CI)
- [ ] If a CSP ships later: `script-src plausible.io` (web) and `connect-src plausible.io`
      (app) — noted for the same-origin `app.cognos.io` hosting plan

## 12. Later / open questions

- **In-app opt-out toggle** (Account → privacy): not legally required (no personal data,
  no cookies) but on-brand. Needs i18n in six locales — P1.
- **Self-hosting Plausible CE** on the Hetzner box if we outgrow Cloud or want
  Switzerland-only residency. The interface makes this a config change (`apiHost`).
- **Proxying the marketing script** through `cognos.io` to survive blockers — decide after
  we see how much traffic ad-blocks (Plausible is blocked less than GA, but not never).
- **Revenue props** on `checkout_completed` (§8) — P1.
- **Web business funnel:** the `/business` page is a stub target today; instrument once it exists.
