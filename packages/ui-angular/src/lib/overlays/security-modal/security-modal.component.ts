import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { type CognosIconName } from '@cognos/ui/icons';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosIconComponent } from '../../icon/icon.component';
import { CognosLozengeComponent } from '../../primitives/lozenge/lozenge.component';
import { CognosModalComponent } from '../modal/modal.component';

/** One reassurance row (icon + heading + copy). */
export interface SecurityModalItem {
  icon: CognosIconName;
  title: string;
  copy: string;
}

/** A label/value detail row (model & provider, region, auto-delete). */
export interface SecurityModalRow {
  /** Icon name for the row (e.g. "sparkles", "server", "eraser"). */
  icon: CognosIconName;
  label: string;
  value: string;
}

/** An outbound link to a marketing/legal page. */
export interface SecurityModalLink {
  label: string;
  href: string;
}

/**
 * All copy for the panel. The component is presentational and i18n-agnostic —
 * the host passes already-translated strings (the library is not wired to
 * transloco), and, crucially, the region-aware `computeTitle`/`computeFlag` so
 * the compute-location step reflects the conversation's ACTUAL served region
 * instead of a hardcoded "Swiss compute".
 */
export interface SecurityModalContent {
  title: string;
  items: SecurityModalItem[];
  caveatTitle: string;
  caveatCopy: string;
  flowDeviceTitle: string;
  flowEncryptedSub: string;
  flowReencryptedSub: string;
  /** Compute-step flag emoji for the served region (e.g. "🇨🇭"). */
  computeFlag: string;
  /** Compute-step title, e.g. "Swiss gateway" / "EU gateway" / "Global gateway". */
  computeTitle: string;
  /** Compute-step sub, e.g. "Plaintext · transient". */
  computeSub: string;
  /** Detail rows (model & provider, region, auto-delete). */
  rows: SecurityModalRow[];
  keysLabel: string;
  deviceKeyLabel: string;
  verifiedLabel: string;
  /** Marketing/legal links rendered at the foot of the panel. */
  links: SecurityModalLink[];
  closeLabel: string;
}

// English defaults so the component renders standalone (Storybook) and any
// host that has not yet supplied translated content still shows sensible copy.
// The frontend always passes fully translated, conversation-specific content.
export const DEFAULT_SECURITY_MODAL_CONTENT: SecurityModalContent = {
  title: 'Security & keys',
  items: [
    {
      icon: 'lock',
      title: 'Encrypted on this device',
      copy: 'Messages are sealed in your browser before they’re stored. We hold ciphertext, never the key.',
    },
    {
      icon: 'eye-off',
      title: 'Only you can read them',
      copy: 'Decryption happens on your device — or the devices of people you explicitly share with.',
    },
    {
      icon: 'graduation-cap',
      title: 'Not used for training',
      copy: 'Approved providers answer under no-retention, no-training terms. Your chats never become training data.',
    },
    {
      icon: 'search',
      title: 'Search runs locally',
      copy: 'Your history is searched on this device. Queries are never sent to us.',
    },
  ],
  caveatTitle: 'The one honest caveat',
  caveatCopy:
    'To generate a reply, the model has to read your message in cleartext — for the moment it runs, in the region you choose. We re-encrypt the reply as soon as it’s generated and don’t store the plaintext.',
  flowDeviceTitle: 'Your device',
  flowEncryptedSub: 'Encrypted',
  flowReencryptedSub: 'Re-encrypted',
  computeFlag: '🇨🇭',
  computeTitle: 'Swiss gateway',
  computeSub: 'Plaintext · transient',
  rows: [],
  keysLabel: 'Your keys',
  deviceKeyLabel: 'Device key',
  verifiedLabel: 'Verified',
  links: [],
  closeLabel: 'Got it',
};

/**
 * The unified per-chat privacy panel. It answers, for one conversation: is it
 * stored, is it encrypted, is it used for training, which model/provider &
 * region served it, and what the retention is — plus links out to the security
 * and subprocessors pages. Purely presentational: the host supplies the real,
 * conversation-specific, translated content and the device-key fingerprint.
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
      [title]="content().title"
      [width]="580"
      [stickyFooter]="true"
      (close)="onClose()"
    >
      <div class="cog-security-modal">
        <ul class="cog-security-modal__items">
          @for (item of content().items; track item.title) {
            <li class="cog-security-modal__item">
              <cog-icon [name]="item.icon" [size]="20" tone="success" />
              <div>
                <h3 class="cog-security-modal__item-title">{{ item.title }}</h3>
                <p class="cog-security-modal__item-copy">{{ item.copy }}</p>
              </div>
            </li>
          }
        </ul>

        <section class="cog-security-modal__caveat">
          <header class="cog-security-modal__caveat-header">
            <cog-icon name="info" [size]="18" tone="brand" />
            <h3 class="cog-security-modal__caveat-title">
              {{ content().caveatTitle }}
            </h3>
          </header>
          <p class="cog-security-modal__caveat-copy">{{ content().caveatCopy }}</p>

          <div class="cog-security-modal__flow">
            <div class="cog-security-modal__step">
              <cog-icon name="laptop" [size]="22" tone="text-subtle" />
              <span class="cog-security-modal__step-title">
                {{ content().flowDeviceTitle }}
              </span>
              <span class="cog-security-modal__step-sub">
                {{ content().flowEncryptedSub }}
              </span>
            </div>

            <cog-icon
              class="cog-security-modal__arrow"
              name="chevron-right"
              [size]="18"
              tone="text-subtlest"
            />

            <div class="cog-security-modal__step cog-security-modal__step--active">
              <span class="cog-security-modal__step-flag" aria-hidden="true">
                {{ content().computeFlag }}
              </span>
              <span class="cog-security-modal__step-title">
                {{ content().computeTitle }}
              </span>
              <span
                class="cog-security-modal__step-sub cog-security-modal__step-sub--active"
              >
                {{ content().computeSub }}
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
              <span class="cog-security-modal__step-title">
                {{ content().flowDeviceTitle }}
              </span>
              <span class="cog-security-modal__step-sub">
                {{ content().flowReencryptedSub }}
              </span>
            </div>
          </div>
        </section>

        @if (content().rows.length) {
          <dl class="cog-security-modal__rows">
            @for (row of content().rows; track row.label) {
              <div class="cog-security-modal__row">
                <cog-icon [name]="row.icon" [size]="18" tone="text-subtle" />
                <dt class="cog-security-modal__row-label">{{ row.label }}</dt>
                <dd class="cog-security-modal__row-value">{{ row.value }}</dd>
              </div>
            }
          </dl>
        }

        @if (fingerprint()) {
          <div class="cog-security-modal__keys">
            <div class="cog-security-modal__keys-label">{{ content().keysLabel }}</div>
            <div class="cog-security-modal__key-row">
              <cog-icon name="key-round" [size]="18" tone="text-subtle" />
              <span class="cog-security-modal__key-name">
                {{ content().deviceKeyLabel }}
              </span>
              <span class="cog-security-modal__key-trailing">
                <span class="cog-security-modal__fingerprint">
                  {{ fingerprint() }}
                </span>
                @if (verified()) {
                  <cog-lozenge tone="green">{{ content().verifiedLabel }}</cog-lozenge>
                }
              </span>
            </div>
          </div>
        }

        @if (content().links.length) {
          <nav class="cog-security-modal__links">
            @for (link of content().links; track link.href) {
              <a
                class="cog-security-modal__link"
                [href]="link.href"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ link.label }}
                <cog-icon name="link" [size]="14" tone="text-subtle" />
              </a>
            }
          </nav>
        }
      </div>

      <div cogModalFooter>
        <cog-button appearance="primary" (click)="onClose()">
          {{ content().closeLabel }}
        </cog-button>
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
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: var(--cog-space-150) var(--cog-space-100);
        text-align: center;
      }

      .cog-security-modal__step--active {
        border-color: var(--cog-success-text);
      }

      .cog-security-modal__step-flag {
        font-size: 22px;
        line-height: 1;
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

      .cog-security-modal__rows {
        display: grid;
        gap: var(--cog-space-100);
        margin: 0;
      }

      .cog-security-modal__row {
        display: grid;
        grid-template-columns: auto auto minmax(0, 1fr);
        align-items: center;
        gap: var(--cog-space-150);
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        padding: var(--cog-space-100) var(--cog-space-150);
      }

      .cog-security-modal__row-label {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-security-modal__row-value {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-body-sm);
        font-weight: var(--cog-fw-medium);
        line-height: var(--cog-lh-body-sm);
        text-align: right;
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
        border: var(--cog-border-width) solid var(--cog-border);
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

      .cog-security-modal__links {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cog-space-200);
      }

      .cog-security-modal__link {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-050);
        color: var(--cog-link);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
        text-decoration: none;
      }

      .cog-security-modal__link:hover {
        text-decoration: underline;
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
  /** Fully translated, conversation-specific copy. */
  readonly content = input<SecurityModalContent>(DEFAULT_SECURITY_MODAL_CONTENT);
  readonly close = output<void>();

  protected onClose(): void {
    this.close.emit();
  }
}
