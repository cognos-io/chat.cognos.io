import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CognosButtonComponent } from '../../../button/button.component';
import { CognosAssistantMessageComponent } from '../../../chat/assistant-message/assistant-message.component';
import { CognosComposerComponent } from '../../../chat/composer/composer.component';
import { CognosRedactedTextComponent } from '../../../chat/redacted-text/redacted-text.component';
import { CognosUserMessageComponent } from '../../../chat/user-message/user-message.component';
import { CognosIconComponent } from '../../../icon/icon.component';
import { CognosNavItemComponent } from '../../../navigation/nav-item/nav-item.component';
import { CognosAvatarComponent } from '../../../primitives/avatar/avatar.component';
import { CognosIconButtonComponent } from '../../../primitives/icon-button/icon-button.component';
import { CognosLozengeComponent } from '../../../primitives/lozenge/lozenge.component';
import { CognosTextFieldComponent } from '../../../primitives/text-field/text-field.component';
import { CognosDesktopShellComponent } from '../desktop-shell.component';

@Component({
  selector: 'cog-desktop-shell-showcase',
  standalone: true,
  imports: [
    CognosAssistantMessageComponent,
    CognosAvatarComponent,
    CognosButtonComponent,
    CognosComposerComponent,
    CognosDesktopShellComponent,
    CognosRedactedTextComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosNavItemComponent,
    CognosTextFieldComponent,
    CognosUserMessageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-desktop-shell
      [breadcrumbs]="breadcrumbs()"
      [navFooter]="true"
      [title]="title()"
    >
      <div cogDesktopNav class="cog-desktop-shell-showcase__nav">
        <div class="cog-desktop-shell-showcase__brand">
          <span class="cog-desktop-shell-showcase__brand-mark">
            <cog-icon name="lock" [size]="16" tone="current" />
          </span>
          <span class="cog-desktop-shell-showcase__brand-name">Cognos</span>
        </div>

        <cog-button appearance="primary" [fullWidth]="true" size="md" type="button">
          <cog-icon name="plus" [size]="16" tone="current" />
          New chat
        </cog-button>

        <div class="cog-desktop-shell-showcase__search">
          <cog-text-field icon="search" placeholder="Search" />
          <div class="cog-desktop-shell-showcase__search-meta">
            <cog-icon name="laptop" [size]="12" tone="text-subtlest" />
            <span>Searched on this device</span>
          </div>
        </div>

        <section class="cog-desktop-shell-showcase__section">
          <h2 class="cog-desktop-shell-showcase__section-title">Projects</h2>
          <div class="cog-desktop-shell-showcase__list">
            <cog-nav-item
              icon="landmark"
              label="Cantonal Policy"
              meta="4"
              [expandable]="true"
              [expanded]="true"
            >
              <cog-nav-item label="Data Protection Act — impact" [indent]="1" />
              <cog-nav-item label="Consultation response draft" [indent]="1" />
              <cog-nav-item
                label="Cross-border data transfer memo"
                [indent]="1"
                [pinned]="true"
              />
            </cog-nav-item>
            <cog-nav-item
              icon="graduation-cap"
              label="Lycée — Year 11"
              meta="2"
              [expandable]="true"
              [expanded]="false"
            />
            <cog-nav-item
              icon="lock"
              label="Private"
              meta="1"
              [expandable]="true"
              [expanded]="false"
            />
          </div>
        </section>

        <section
          class="cog-desktop-shell-showcase__section cog-desktop-shell-showcase__section--grow"
        >
          <h2 class="cog-desktop-shell-showcase__section-title">Recent</h2>
          <div class="cog-desktop-shell-showcase__list">
            <cog-nav-item
              icon="message-square"
              label="FOI request — draft reply"
              [selected]="true"
            />
            <cog-nav-item icon="message-square" label="Encryption key rotation" />
            <cog-nav-item icon="message-square" label="Summarise procurement PDF" />
            <cog-nav-item icon="message-square" label="FOI request triage" />
            <cog-nav-item icon="message-square" label="Translate notice → FR, IT" />
            <cog-nav-item icon="message-square" label="Draft staff guidance" />
          </div>
        </section>
      </div>

      <section cogDesktopNavFooter class="cog-desktop-shell-showcase__security">
        <div class="cog-desktop-shell-showcase__security-header">
          <div class="cog-desktop-shell-showcase__security-status">
            <span class="cog-desktop-shell-showcase__security-icon">
              <cog-icon name="shield-check" [size]="16" tone="current" />
            </span>
            <strong>Encrypted</strong>
            <cog-lozenge tone="green">Verified</cog-lozenge>
          </div>
          <cog-icon name="chevron-right" [size]="16" tone="text-subtlest" />
        </div>
        <div class="cog-desktop-shell-showcase__security-copy">
          Keys on this device · 9F2A.7C41
        </div>
      </section>

      <div cogDesktopActions class="cog-desktop-shell-showcase__actions">
        <cog-avatar name="Yara" [size]="28" />
        <cog-avatar name="Luca" [size]="28" />
        <cog-avatar [group]="true" [size]="28" />
        <cog-button appearance="default" type="button">
          <cog-icon name="user-plus" [size]="16" tone="text-subtle" />
          Share
        </cog-button>
        <cog-icon-button name="shield" title="Security" />
        <cog-icon-button name="more-horizontal" title="More actions" />
      </div>

      <div class="cog-desktop-shell-showcase__conversation">
        <div class="cog-desktop-shell-showcase__messages">
          <cog-user-message meta="Encrypted · 14:32"
            >Draft a short, friendly reply to
            <cog-redacted-text
              kind="name"
              value="Laurent Meyer"
              placeholder="REDACTED_NAME_2C31"
            />
            (<cog-redacted-text
              kind="email"
              value="l.meyer@example.ch"
              placeholder="REDACTED_EMAIL_7A6F"
            />) about their case
            <cog-redacted-text
              kind="case-id"
              value="GE-2026-0417"
              placeholder="REDACTED_CASE_ID_17D0"
            />
            — they also left a number,
            <cog-redacted-text
              kind="phone"
              value="+41 22 555 0143"
              placeholder="REDACTED_PHONE_510B"
            />.</cog-user-message
          >

          <cog-assistant-message
            model="Cognos Sovereign"
            time="14:32"
            [showActions]="false"
            [sources]="0"
          >
            <div class="cog-desktop-shell-showcase__assistant-copy">
              <p>
                Here’s a draft you can send to
                <cog-redacted-text
                  kind="name"
                  value="Laurent Meyer"
                  placeholder="REDACTED_NAME_2C31"
                />:
              </p>
              <p>
                <strong
                  >Subject — Your enquiry (case
                  <cog-redacted-text
                    kind="case-id"
                    value="GE-2026-0417"
                    placeholder="REDACTED_CASE_ID_17D0"
                  />)</strong
                >
              </p>
              <p>
                Dear
                <cog-redacted-text
                  kind="name"
                  value="Laurent Meyer"
                  placeholder="REDACTED_NAME_2C31"
                />,
              </p>
              <p>
                Thank you for getting in touch. We’ve received your request and logged
                it under
                <cog-redacted-text
                  kind="case-id"
                  value="GE-2026-0417"
                  placeholder="REDACTED_CASE_ID_17D0"
                />. I’ll follow up by email at
                <cog-redacted-text
                  kind="email"
                  value="l.meyer@example.ch"
                  placeholder="REDACTED_EMAIL_7A6F"
                />
                within three working days; if anything is urgent, please call our office
                and quote your case number.
              </p>
              <p>Kind regards,<br />Policy Unit</p>
              <p>
                <strong>Note</strong> — I never saw the real name, email, phone or case
                ID. Only the placeholders above were sent to me.
              </p>
            </div>
          </cog-assistant-message>
        </div>

        <div class="cog-desktop-shell-showcase__composer-wrap">
          <cog-composer modelLabel="Cognos Sovereign" />
        </div>
      </div>
    </cog-desktop-shell>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-desktop-shell-showcase__nav {
        display: grid;
        min-height: 100%;
        grid-template-rows: auto auto auto auto 1fr;
        gap: var(--cog-space-200);
      }

      .cog-desktop-shell-showcase__brand {
        display: flex;
        align-items: center;
        gap: var(--cog-space-150);
        border-bottom: 1px solid var(--cog-border);
        padding-bottom: var(--cog-space-150);
      }

      .cog-desktop-shell-showcase__brand-mark {
        display: inline-flex;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        background: var(--cog-brand);
        color: var(--cog-on-brand);
      }

      .cog-desktop-shell-showcase__brand-name {
        color: var(--cog-text);
        font-size: var(--cog-fs-h-lg);
        font-weight: var(--cog-fw-h-lg);
        line-height: var(--cog-lh-h-lg);
      }

      .cog-desktop-shell-showcase__search {
        display: grid;
        gap: var(--cog-space-100);
      }

      .cog-desktop-shell-showcase__search-meta {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-075);
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-desktop-shell-showcase__section {
        display: grid;
        gap: 10px;
      }

      .cog-desktop-shell-showcase__section--grow {
        align-content: start;
      }

      .cog-desktop-shell-showcase__section-title {
        margin: 0;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        line-height: var(--cog-lh-overline);
        letter-spacing: var(--cog-ls-overline);
        text-transform: var(--cog-tt-overline);
      }

      .cog-desktop-shell-showcase__list {
        display: grid;
        gap: 6px;
      }

      .cog-desktop-shell-showcase__security {
        display: grid;
        gap: var(--cog-space-075);
      }

      .cog-desktop-shell-showcase__security-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
      }

      .cog-desktop-shell-showcase__security-status {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-100);
        color: var(--cog-text);
      }

      .cog-desktop-shell-showcase__security-icon {
        display: inline-flex;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-selected-bg);
        color: var(--cog-selected-text);
      }

      .cog-desktop-shell-showcase__security-copy {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-desktop-shell-showcase__actions {
        display: flex;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-desktop-shell-showcase__conversation {
        display: flex;
        min-height: calc(100vh - 180px);
        max-width: 920px;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--cog-space-500);
      }

      .cog-desktop-shell-showcase__messages {
        display: grid;
        gap: 28px;
        padding-top: var(--cog-space-100);
      }

      .cog-desktop-shell-showcase__assistant-copy {
        display: grid;
        gap: 14px;
      }

      .cog-desktop-shell-showcase__assistant-copy p {
        margin: 0;
      }

      .cog-desktop-shell-showcase__composer-wrap {
        max-width: 820px;
        margin-left: 96px;
      }
    `,
  ],
})
export class CognosDesktopShellShowcaseComponent {
  readonly title = input('FOI request — draft reply');

  protected readonly breadcrumbs = computed(() => [
    { label: 'Cognos' },
    { label: this.title(), current: true },
  ]);
}
