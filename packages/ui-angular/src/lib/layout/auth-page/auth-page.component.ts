import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/**
 * CognosAuthPageComponent (`cog-auth-page`) is the shared layout for every
 * unauthenticated page (login, register, forgot/reset password, verify/confirm
 * email): the gradient background, the centred raised card, and — via the
 * documented `auth-page__*` classes below — consistent logo/title/lead/form/
 * field/legal typography and the mobile full-height treatment.
 *
 * Projection-based, so the host owns its form + links. Mark up projected content
 * with the `auth-page__*` classes; this component styles them:
 *
 *   <cog-auth-page>
 *     <app-cognos-logo class="auth-page__logo" />
 *     <h1 class="auth-page__title">…</h1>
 *     <p class="auth-page__lead">…</p>
 *     <form class="auth-page__form">
 *       <div class="auth-page__field">
 *         <label class="auth-page__label" for="email">…</label>
 *         <input id="email" class="auth-page__input" … />
 *       </div>
 *       <cog-button …>…</cog-button>
 *     </form>
 *     <p class="auth-page__switch"><a …>…</a></p>
 *   </cog-auth-page>
 *
 * `auth-page__divider` renders an "or" rule between an OAuth button and the
 * password form, e.g. `<p class="auth-page__divider">{{ t('common.or') }}</p>`.
 *
 * `auth-page__field` is a plain `<div>`, not a `<label>` — the `<label for>`
 * inside it names only the control it points at. Never nest hint/error text
 * inside the label element: the browser folds any text content of a wrapping
 * label into the control's accessible name (so "Password" + a hint reads as
 * one garbled name to screen readers and breaks `getByLabel`-style queries).
 * Put hint/error text in a sibling element with its own `id` and wire it up
 * with `[attr.aria-describedby]` on the input instead — a description, not
 * part of the name. See `register.component.ts` for a worked example.
 *
 * Uses ViewEncapsulation.None so it can style projected content; every selector
 * is namespaced under the unique `.auth-page` prefix to keep it safely global.
 */
@Component({
  selector: 'cog-auth-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="auth-page">
      <section class="auth-page__card">
        <ng-content />
      </section>
    </div>
  `,
  styles: [
    `
      .auth-page {
        display: grid;
        min-height: 100vh;
        min-height: 100svh;
        place-items: center;
        padding: var(--cog-space-300);
        background:
          radial-gradient(
            circle at top left,
            color-mix(in srgb, var(--cog-success-bg) 78%, transparent),
            transparent 35%
          ),
          var(--cog-app-bg);
      }

      .auth-page__card {
        display: grid;
        width: min(100%, 460px);
        gap: var(--cog-space-150);
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-raised);
        padding: var(--cog-space-400);
      }

      .auth-page__form,
      .auth-page__field {
        display: grid;
        gap: var(--cog-space-150);
      }

      .auth-page__logo {
        height: 28px;
      }

      .auth-page__title,
      .auth-page__lead,
      .auth-page__switch,
      .auth-page__legal,
      .auth-page__success {
        margin: 0;
      }

      .auth-page__title {
        color: var(--cog-text);
        font-size: var(--cog-fs-display);
        font-weight: var(--cog-fw-display);
        line-height: var(--cog-lh-display);
        letter-spacing: var(--cog-ls-display);
        text-wrap: balance;
      }

      .auth-page__lead,
      .auth-page__switch,
      .auth-page__legal,
      .auth-page__hint {
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        text-wrap: pretty;
      }

      .auth-page__label {
        color: var(--cog-text);
        font-size: var(--cog-fs-body-sm);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body-sm);
      }

      .auth-page__input {
        min-height: 44px;
        border: var(--cog-border-width-strong) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-input-bg);
        color: var(--cog-text);
        padding: 0 var(--cog-space-150);
        font: inherit;
        outline: 0;
      }

      .auth-page__input:focus {
        border-color: var(--cog-brand);
        background: var(--cog-input-bg-focus);
      }

      .auth-page__remember {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-100);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
        cursor: pointer;
      }

      .auth-page__success {
        color: var(--cog-text);
        border: var(--cog-border-width) solid
          var(--cog-success-border, var(--cog-border));
        background: var(--cog-success-bg);
        padding: var(--cog-space-200);
        border-radius: var(--cog-radius-sm);
      }

      .auth-page__legal a,
      .auth-page__switch a,
      .auth-page__switch .auth-page__link-button {
        color: var(--cog-link);
      }

      .auth-page__switch .auth-page__link-button {
        border: 0;
        background: transparent;
        padding: 0;
        font: inherit;
        text-align: inherit;
        cursor: pointer;
      }

      .auth-page__loading-copy {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .auth-page__loading-copy app-loading-indicator {
        padding: 0;
      }

      .auth-page__divider {
        display: flex;
        align-items: center;
        gap: var(--cog-space-150);
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .auth-page__divider::before,
      .auth-page__divider::after {
        content: '';
        flex: 1;
        height: var(--cog-border-width);
        background: var(--cog-border);
      }

      @media (max-width: 640px) {
        .auth-page {
          place-items: stretch;
          padding: 0;
        }

        .auth-page__card {
          width: 100%;
          max-width: none;
          min-height: 100svh;
          border: 0;
          border-radius: 0;
          box-shadow: none;
          background: transparent;
          padding: var(--cog-space-400) var(--cog-space-300)
            calc(env(safe-area-inset-bottom, 0px) + var(--cog-space-500));
          align-content: end;
        }
      }
    `,
  ],
})
export class CognosAuthPageComponent {}
