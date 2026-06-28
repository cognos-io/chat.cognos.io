import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosButtonComponent } from '../../button/button.component';
import { injectIsMobile } from '../../foundations/breakpoint';
import { CognosIconComponent } from '../../icon/icon.component';
import { CognosModalComponent } from '../../overlays/modal/modal.component';
import { CognosLozengeComponent } from '../../primitives/lozenge/lozenge.component';

export type CognosRedactedTextKind = 'name' | 'email' | 'phone' | 'case-id' | 'custom';

// All user-visible copy in the explainer modal. Exposed as a single input so the
// host app can supply localised strings (the library stays translation-free);
// English defaults keep standalone/storybook usage working.
export interface CognosRedactedTextLabels {
  title: string;
  detected: string;
  explainer: string;
  youSee: string;
  modelSees: string;
  notice: string;
  copy: string;
  settings: string;
  done: string;
}

export const COGNOS_REDACTED_TEXT_DEFAULT_LABELS: CognosRedactedTextLabels = {
  title: 'Personal information redacted',
  detected: 'detected & protected on this device',
  explainer:
    'Cognos found a sensitive value in this message and replaced it with a placeholder before anything left your device. The AI model only ever sees the placeholder — never the real value.',
  youSee: 'You see',
  modelSees: 'The model sees',
  notice:
    'The real value never leaves this device. Cognos sends only the placeholder to the model, then restores it in your browser when the reply comes back.',
  copy: 'Copy',
  settings: 'Redaction settings',
  done: 'Done',
};

@Component({
  selector: 'cog-redacted-text',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="cog-redacted-text"
      role="button"
      tabindex="0"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-haspopup]="'dialog'"
      [attr.title]="text().title"
      (click)="openDetails()"
      (keydown)="onTriggerKeydown($event)"
    >
      <cog-icon [name]="inlineIcon()" [size]="14" tone="current" />
      <span>{{ displayValue() }}</span>
    </span>

    <cog-modal
      [open]="detailsOpen()"
      [stickyFooter]="true"
      [title]="text().title"
      [width]="560"
      (close)="closeDetails()"
    >
      <div class="cog-redacted-text__details">
        <div class="cog-redacted-text__eyebrow">
          <cog-lozenge tone="purple">
            <cog-icon [name]="badgeIcon()" [size]="12" tone="current" />
            {{ badgeLabel() }}
          </cog-lozenge>
          <span>{{ text().detected }}</span>
        </div>

        <p class="cog-redacted-text__copy">{{ text().explainer }}</p>

        <section
          class="cog-redacted-text__comparison"
          aria-label="Redaction comparison"
        >
          <div class="cog-redacted-text__comparison-row">
            <div class="cog-redacted-text__comparison-content">
              <div class="cog-redacted-text__comparison-label">{{ text().youSee }}</div>
              <div class="cog-redacted-text__comparison-value">
                <strong>{{ value() }}</strong>
              </div>
            </div>
            <cog-button
              appearance="subtle"
              icon="copy"
              type="button"
              (click)="copyValue()"
            >
              {{ text().copy }}
            </cog-button>
          </div>

          <div
            class="cog-redacted-text__comparison-row cog-redacted-text__comparison-row--muted"
          >
            <div class="cog-redacted-text__comparison-content">
              <div class="cog-redacted-text__comparison-label">
                {{ text().modelSees }}
              </div>
              <div class="cog-redacted-text__comparison-placeholder">
                {{ placeholder() }}
              </div>
            </div>
          </div>
        </section>

        <section class="cog-redacted-text__notice">
          <span class="cog-redacted-text__notice-icon">
            <cog-icon name="shield-check" [size]="16" tone="current" />
          </span>
          <p>{{ text().notice }}</p>
        </section>
      </div>

      <div cogModalFooter class="cog-redacted-text__footer">
        @if (showSettings()) {
          <cog-button
            appearance="link"
            icon="settings"
            type="button"
            [fullWidth]="isMobile()"
            (click)="onOpenSettings()"
          >
            {{ text().settings }}
          </cog-button>
        } @else {
          <span></span>
        }

        <cog-button
          appearance="primary"
          type="button"
          [fullWidth]="isMobile()"
          (click)="closeDetails()"
        >
          {{ text().done }}
        </cog-button>
      </div>
    </cog-modal>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      .cog-redacted-text {
        display: inline;
        border: 0;
        border-radius: var(--cog-radius-xs);
        background: var(--cog-loz-purple-bg);
        box-shadow: inset 0 -1px 0 var(--cog-loz-purple-fg);
        color: var(--cog-loz-purple-fg);
        cursor: pointer;
        padding: 1px 6px;
        font: inherit;
        line-height: 1.3;
        vertical-align: baseline;
        white-space: nowrap;
        user-select: text;
        -webkit-user-select: text;
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          box-shadow var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-redacted-text cog-icon {
        margin-right: var(--cog-space-050);
        user-select: none;
        -webkit-user-select: none;
      }

      .cog-redacted-text:hover {
        box-shadow: inset 0 -2px 0 var(--cog-loz-purple-fg);
      }

      .cog-redacted-text:focus-visible {
        outline: 2px solid var(--cog-brand);
        outline-offset: 2px;
      }

      .cog-redacted-text__details {
        display: grid;
        gap: var(--cog-space-200);
        color: var(--cog-text);
      }

      .cog-redacted-text__eyebrow {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-150);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-redacted-text__copy {
        margin: 0;
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        text-wrap: pretty;
      }

      .cog-redacted-text__comparison {
        display: grid;
        overflow: hidden;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
      }

      .cog-redacted-text__comparison-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: var(--cog-space-150);
        align-items: center;
        padding: var(--cog-space-200);
      }

      .cog-redacted-text__comparison-row--muted {
        border-top: 1px solid var(--cog-border);
        background: var(--cog-surface-sunken);
      }

      .cog-redacted-text__comparison-content {
        min-width: 0;
      }

      .cog-redacted-text__comparison-label {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        letter-spacing: var(--cog-ls-overline);
        line-height: var(--cog-lh-overline);
        margin-bottom: var(--cog-space-050);
        text-transform: var(--cog-tt-overline);
      }

      .cog-redacted-text__comparison-value {
        color: var(--cog-text);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
      }

      .cog-redacted-text__comparison-placeholder {
        color: var(--cog-text-subtle);
        font-family: var(--cog-font-mono);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
      }

      .cog-redacted-text__notice {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: var(--cog-space-150);
        align-items: start;
        border-radius: var(--cog-radius-sm);
        background: var(--cog-success-bg);
        color: var(--cog-success-text);
        padding: var(--cog-space-200);
      }

      .cog-redacted-text__notice p {
        margin: 0;
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        text-wrap: pretty;
      }

      .cog-redacted-text__notice-icon {
        display: inline-flex;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-surface);
        color: var(--cog-success-text);
      }

      .cog-redacted-text__footer {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-100);
      }

      @media (max-width: 600px) {
        .cog-redacted-text__comparison-row {
          grid-template-columns: minmax(0, 1fr);
        }

        .cog-redacted-text__footer {
          flex-direction: column;
          align-items: stretch;
        }
      }
    `,
  ],
})
export class CognosRedactedTextComponent {
  // Full-width footer buttons on the mobile sheet (inline on desktop).
  protected readonly isMobile = injectIsMobile();

  readonly value = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly kind = input<CognosRedactedTextKind>('custom');
  readonly label = input('');
  readonly showSettings = input(true);
  // When true the inline pill shows a mask instead of the real value, so the
  // chat can be screen-shared without leaking it. The explainer modal still
  // reveals the value on an explicit click.
  readonly masked = input(false);
  // Localised modal copy; merged over English defaults so partial overrides work.
  readonly labels = input<Partial<CognosRedactedTextLabels>>({});
  readonly openSettings = output<void>();

  protected readonly detailsOpen = signal(false);

  // The masked inline form: a fixed bullet run, so its width never hints at the
  // length of the hidden value.
  protected readonly displayValue = computed(() =>
    this.masked() ? '••••••' : this.value(),
  );

  protected readonly text = computed<CognosRedactedTextLabels>(() => ({
    ...COGNOS_REDACTED_TEXT_DEFAULT_LABELS,
    ...this.labels(),
  }));

  // The badge prefers an explicit label (the host's localised type name) and
  // falls back to the built-in label for the known kinds.
  protected readonly badgeLabel = computed(
    () => this.label() || this.kindConfig().label,
  );
  protected readonly badgeIcon = computed<CognosIconName>(() => this.kindConfig().icon);
  protected readonly inlineIcon = computed<CognosIconName>(() =>
    this.kind() === 'email' ? 'mail' : 'eye-off',
  );
  protected readonly ariaLabel = computed(
    () => `${this.text().title}: ${this.badgeLabel()}`,
  );

  protected openDetails(): void {
    this.detailsOpen.set(true);
  }

  protected closeDetails(): void {
    this.detailsOpen.set(false);
  }

  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.openDetails();
  }

  protected copyValue(): void {
    void globalThis.navigator?.clipboard?.writeText(this.value());
  }

  protected onOpenSettings(): void {
    this.openSettings.emit();
  }

  private kindConfig(): { icon: CognosIconName; label: string } {
    switch (this.kind()) {
      case 'name':
        return { icon: 'eye-off', label: 'Name' };
      case 'email':
        return { icon: 'mail', label: 'Email address' };
      case 'phone':
        return { icon: 'eye-off', label: 'Phone number' };
      case 'case-id':
        return { icon: 'eye-off', label: 'Case ID' };
      default:
        return { icon: 'eye-off', label: this.label() || 'Redacted value' };
    }
  }
}
