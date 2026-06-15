import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { CognosButtonComponent } from '../../../button/button.component';
import { CognosAssistantMessageComponent } from '../../../chat/assistant-message/assistant-message.component';
import { CognosComposerComponent } from '../../../chat/composer/composer.component';
import { CognosUserMessageComponent } from '../../../chat/user-message/user-message.component';
import { CognosIconComponent } from '../../../icon/icon.component';
import { CognosNavItemComponent } from '../../../navigation/nav-item/nav-item.component';
import { CognosIconButtonComponent } from '../../../primitives/icon-button/icon-button.component';
import { CognosLozengeComponent } from '../../../primitives/lozenge/lozenge.component';
import { CognosTextFieldComponent } from '../../../primitives/text-field/text-field.component';
import { CognosMobileShellComponent } from '../mobile-shell.component';

@Component({
  selector: 'cog-mobile-shell-showcase',
  standalone: true,
  imports: [
    CognosAssistantMessageComponent,
    CognosButtonComponent,
    CognosComposerComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosMobileShellComponent,
    CognosNavItemComponent,
    CognosTextFieldComponent,
    CognosUserMessageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-mobile-shell-showcase">
      <cog-mobile-shell
        [drawerFooter]="true"
        [drawerOpen]="drawerOpen()"
        [drawerTitle]="'Cognos'"
        [title]="title()"
      >
        <div cogMobileActions>
          <cog-icon-button name="more-horizontal" size="lg" title="More actions" />
        </div>

        <div cogMobileDrawer class="cog-mobile-shell-showcase__drawer">
          <cog-button appearance="primary" [fullWidth]="true" size="md" type="button">
            <cog-icon name="plus" [size]="16" tone="current" />
            New chat
          </cog-button>

          <div class="cog-mobile-shell-showcase__search">
            <cog-text-field icon="search" placeholder="Search" />
            <div class="cog-mobile-shell-showcase__search-meta">
              <cog-icon name="laptop" [size]="12" tone="text-subtlest" />
              <span>Searched on this device</span>
            </div>
          </div>

          <section class="cog-mobile-shell-showcase__section">
            <h2 class="cog-mobile-shell-showcase__section-title">Projects</h2>
            <div class="cog-mobile-shell-showcase__list">
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
              />
              <cog-nav-item icon="lock" label="Private" meta="1" [expandable]="true" />
            </div>
          </section>

          <section
            class="cog-mobile-shell-showcase__section cog-mobile-shell-showcase__section--grow"
          >
            <h2 class="cog-mobile-shell-showcase__section-title">Recent</h2>
            <div class="cog-mobile-shell-showcase__list">
              <cog-nav-item
                icon="message-square"
                label="FOI request — draft reply"
                [selected]="true"
              />
              <cog-nav-item icon="message-square" label="Encryption key rotation" />
              <cog-nav-item icon="message-square" label="Summarise procurement PDF" />
              <cog-nav-item icon="message-square" label="FOI request triage" />
            </div>
          </section>
        </div>

        <section cogMobileDrawerFooter class="cog-mobile-shell-showcase__security">
          <div class="cog-mobile-shell-showcase__security-header">
            <div class="cog-mobile-shell-showcase__security-status">
              <span class="cog-mobile-shell-showcase__security-icon">
                <cog-icon name="shield-check" [size]="16" tone="current" />
              </span>
              <strong>Encrypted</strong>
            </div>
            <cog-lozenge tone="green">Verified</cog-lozenge>
          </div>
          <div class="cog-mobile-shell-showcase__security-copy">
            Keys on this device · 9F2A.7C41
          </div>
        </section>

        <div class="cog-mobile-shell-showcase__content">
          <cog-user-message meta="Encrypted · 14:32">
            Draft a short reply to Laurent Meyer about case GE-2026-0417.
          </cog-user-message>

          <cog-assistant-message
            model="Cognos Sovereign"
            time="14:32"
            [showActions]="false"
            [sources]="0"
          >
            <div class="cog-mobile-shell-showcase__assistant-copy">
              <p>Here’s a draft you can send:</p>
              <p><strong>Subject — Your enquiry (case GE-2026-0417)</strong></p>
              <p>
                Thank you for getting in touch. We’ve logged your request and will
                follow up within three working days.
              </p>
            </div>
          </cog-assistant-message>
        </div>

        <div cogMobileComposer>
          <cog-composer modelLabel="Cognos Sovereign" />
        </div>
      </cog-mobile-shell>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-mobile-shell-showcase {
        max-width: 430px;
        min-height: 100vh;
        margin: 0 auto;
        border-inline: 1px solid var(--cog-border);
        background: var(--cog-app-bg);
      }

      .cog-mobile-shell-showcase__drawer {
        display: grid;
        min-height: 100%;
        grid-template-rows: auto auto auto 1fr;
        gap: var(--cog-space-200);
      }

      .cog-mobile-shell-showcase__search {
        display: grid;
        gap: var(--cog-space-100);
      }

      .cog-mobile-shell-showcase__search-meta {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-075);
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-mobile-shell-showcase__section {
        display: grid;
        gap: 10px;
      }

      .cog-mobile-shell-showcase__section--grow {
        align-content: start;
      }

      .cog-mobile-shell-showcase__section-title {
        margin: 0;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        line-height: var(--cog-lh-overline);
        letter-spacing: var(--cog-ls-overline);
        text-transform: var(--cog-tt-overline);
      }

      .cog-mobile-shell-showcase__list {
        display: grid;
        gap: 6px;
      }

      .cog-mobile-shell-showcase__security {
        display: grid;
        gap: var(--cog-space-075);
      }

      .cog-mobile-shell-showcase__security-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
      }

      .cog-mobile-shell-showcase__security-status {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-100);
        color: var(--cog-text);
      }

      .cog-mobile-shell-showcase__security-icon {
        display: inline-flex;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-selected-bg);
        color: var(--cog-selected-text);
      }

      .cog-mobile-shell-showcase__security-copy {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-mobile-shell-showcase__content {
        display: grid;
        gap: var(--cog-space-300);
        color: var(--cog-text);
      }

      .cog-mobile-shell-showcase__assistant-copy {
        display: grid;
        gap: var(--cog-space-150);
      }

      .cog-mobile-shell-showcase__assistant-copy p {
        margin: 0;
      }
    `,
  ],
})
export class CognosMobileShellShowcaseComponent {
  readonly drawerOpen = input(false);
  readonly title = input('FOI request — draft reply');
}
