import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosIconComponent } from '../../icon/icon.component';
import { CognosLozengeComponent } from '../../primitives/lozenge/lozenge.component';
import { CognosModalComponent } from '../modal/modal.component';

/**
 * Reassurance modal that explains the product's encryption model and surfaces
 * the user's device key. It is purely presentational — the host supplies the
 * real key fingerprint, and only the rows we can back with real data are shown.
 */
@Component({
  selector: 'cog-security-modal',
  standalone: true,
  imports: [
    CognosModalComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-modal
      [open]="open()"
      title="Security & keys"
      [width]="640"
      [stickyFooter]="true"
      (close)="onClose()"
    >
      <div class="cog-security-modal">
        <ul class="cog-security-modal__items">
          <li class="cog-security-modal__item">
            <cog-icon name="lock" [size]="20" tone="success" />
            <div>
              <h3 class="cog-security-modal__item-title">Encrypted on this device</h3>
              <p class="cog-security-modal__item-copy">
                Messages are sealed in your browser before they’re stored. We hold
                ciphertext, never the key.
              </p>
            </div>
          </li>

          <li class="cog-security-modal__item">
            <cog-icon name="eye-off" [size]="20" tone="success" />
            <div>
              <h3 class="cog-security-modal__item-title">Only you can read them</h3>
              <p class="cog-security-modal__item-copy">
                Decryption happens on your device — or the devices of people you
                explicitly share with.
              </p>
            </div>
          </li>

          <li class="cog-security-modal__item">
            <cog-icon name="search" [size]="20" tone="success" />
            <div>
              <h3 class="cog-security-modal__item-title">Search runs locally</h3>
              <p class="cog-security-modal__item-copy">
                Your history is searched on this device. Queries are never sent to us.
              </p>
            </div>
          </li>
        </ul>

        <section class="cog-security-modal__caveat">
          <header class="cog-security-modal__caveat-header">
            <cog-icon name="info" [size]="18" tone="brand" />
            <h3 class="cog-security-modal__caveat-title">The one honest caveat</h3>
          </header>
          <p class="cog-security-modal__caveat-copy">
            To generate a reply, the model has to read your message in cleartext — for
            the moment it runs, on Swiss soil. We re-encrypt the result the instant it’s
            ready and retain nothing.
          </p>

          <div class="cog-security-modal__flow">
            <div class="cog-security-modal__step">
              <cog-icon name="laptop" [size]="22" tone="text-subtle" />
              <span class="cog-security-modal__step-title">Your device</span>
              <span class="cog-security-modal__step-sub">Encrypted</span>
            </div>

            <cog-icon
              class="cog-security-modal__arrow"
              name="chevron-right"
              [size]="18"
              tone="text-subtlest"
            />

            <div class="cog-security-modal__step cog-security-modal__step--active">
              <cog-icon name="server" [size]="22" tone="success" />
              <span class="cog-security-modal__step-title">Swiss compute</span>
              <span
                class="cog-security-modal__step-sub cog-security-modal__step-sub--active"
              >
                Plaintext · transient
              </span>
            </div>

            <cog-icon
              class="cog-security-modal__arrow"
              name="chevron-right"
              [size]="18"
              tone="text-subtlest"
            />

            <div class="cog-security-modal__step">
              <cog-icon name="laptop" [size]="22" tone="text-subtle" />
              <span class="cog-security-modal__step-title">Your device</span>
              <span class="cog-security-modal__step-sub">Re-encrypted</span>
            </div>
          </div>
        </section>

        @if (fingerprint()) {
          <div class="cog-security-modal__keys">
            <div class="cog-security-modal__keys-label">Your keys</div>
            <div class="cog-security-modal__key-row">
              <cog-icon name="key-round" [size]="18" tone="text-subtle" />
              <span class="cog-security-modal__key-name">Device key</span>
              <span class="cog-security-modal__key-trailing">
                <span class="cog-security-modal__fingerprint">
                  {{ fingerprint() }}
                </span>
                @if (verified()) {
                  <cog-lozenge tone="green">Verified</cog-lozenge>
                }
              </span>
            </div>
          </div>
        }
      </div>

      <div cogModalFooter>
        <cog-button appearance="primary" (click)="onClose()">Got it</cog-button>
      </div>
    </cog-modal>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .cog-security-modal {
        display: grid;
        gap: var(--cog-space-200);
      }

      .cog-security-modal__items {
        display: grid;
        gap: var(--cog-space-200);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .cog-security-modal__item {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cog-space-150);
        align-items: start;
      }

      .cog-security-modal__item-title {
        margin: 0 0 var(--cog-space-025);
        color: var(--cog-text);
        font-size: var(--cog-fs-body);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body);
      }

      .cog-security-modal__item-copy {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-security-modal__caveat {
        border-radius: var(--cog-radius-md);
        background: var(--cog-info-bg);
        padding: var(--cog-space-150) var(--cog-space-200) var(--cog-space-200);
      }

      .cog-security-modal__caveat-header {
        display: flex;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-security-modal__caveat-title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-body);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body);
      }

      .cog-security-modal__caveat-copy {
        margin: var(--cog-space-075) 0 var(--cog-space-150);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-security-modal__flow {
        display: grid;
        grid-template-columns: 1fr auto 1fr auto 1fr;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-security-modal__step {
        display: grid;
        justify-items: center;
        gap: var(--cog-space-025);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: var(--cog-space-150) var(--cog-space-100);
        text-align: center;
      }

      .cog-security-modal__step--active {
        border-color: var(--cog-success-text);
      }

      .cog-security-modal__step-title {
        color: var(--cog-text);
        font-size: var(--cog-fs-body-sm);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-security-modal__step-sub {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-security-modal__step-sub--active {
        color: var(--cog-success-text);
      }

      .cog-security-modal__arrow {
        display: inline-flex;
        justify-content: center;
      }

      .cog-security-modal__keys {
        display: grid;
        gap: var(--cog-space-075);
      }

      .cog-security-modal__keys-label {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        letter-spacing: var(--cog-ls-overline);
        line-height: var(--cog-lh-overline);
        text-transform: var(--cog-tt-overline);
      }

      .cog-security-modal__key-row {
        display: flex;
        align-items: center;
        gap: var(--cog-space-150);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        padding: var(--cog-space-150);
      }

      .cog-security-modal__key-name {
        color: var(--cog-text);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
      }

      .cog-security-modal__key-trailing {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-150);
        margin-left: auto;
      }

      .cog-security-modal__fingerprint {
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
      }

      @media (max-width: 600px) {
        .cog-security-modal__flow {
          grid-template-columns: 1fr;
        }

        .cog-security-modal__arrow {
          transform: rotate(90deg);
        }
      }
    `,
  ],
})
export class CognosSecurityModalComponent {
  readonly open = input(false);
  /** Pre-formatted device-key fingerprint (e.g. "9F2A · 7C41 · DD08"). */
  readonly fingerprint = input('');
  readonly verified = input(false);
  readonly close = output<void>();

  protected onClose(): void {
    this.close.emit();
  }
}
