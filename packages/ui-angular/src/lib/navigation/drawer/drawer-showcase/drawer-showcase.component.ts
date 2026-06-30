import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { CognosButtonComponent } from '../../../button/button.component';
import { CognosIconComponent } from '../../../icon/icon.component';
import { CognosLozengeComponent } from '../../../primitives/lozenge/lozenge.component';
import { CognosTextFieldComponent } from '../../../primitives/text-field/text-field.component';
import { CognosNavItemComponent } from '../../nav-item/nav-item.component';
import { CognosDrawerComponent } from '../drawer.component';

@Component({
  selector: 'cog-drawer-showcase',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosDrawerComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosNavItemComponent,
    CognosTextFieldComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-drawer [open]="open()" [stickyFooter]="true" [title]="title()">
      <div class="cog-drawer-showcase">
        <cog-button appearance="primary" [fullWidth]="true" size="md" type="button">
          <cog-icon name="plus" [size]="16" tone="current" />
          New chat
        </cog-button>

        <div class="cog-drawer-showcase__search">
          <cog-text-field icon="search" placeholder="Search" />
          <div class="cog-drawer-showcase__search-meta">
            <cog-icon name="laptop" [size]="12" tone="text-subtlest" />
            <span>Searched on this device</span>
          </div>
        </div>

        <section class="cog-drawer-showcase__section">
          <h2 class="cog-drawer-showcase__section-title">Projects</h2>
          <div class="cog-drawer-showcase__list">
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
          class="cog-drawer-showcase__section cog-drawer-showcase__section--grow"
        >
          <h2 class="cog-drawer-showcase__section-title">Recent</h2>
          <div class="cog-drawer-showcase__list">
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

      <section cogDrawerFooter class="cog-drawer-showcase__security">
        <div class="cog-drawer-showcase__security-header">
          <div class="cog-drawer-showcase__security-status">
            <span class="cog-drawer-showcase__security-icon">
              <cog-icon name="shield-check" [size]="16" tone="current" />
            </span>
            <strong>Encrypted</strong>
          </div>
          <cog-lozenge tone="green">Verified</cog-lozenge>
        </div>
        <div class="cog-drawer-showcase__security-copy">
          Keys on this device · 9F2A.7C41
        </div>
      </section>
    </cog-drawer>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-drawer-showcase {
        display: grid;
        min-height: 100%;
        grid-template-rows: auto auto auto 1fr;
        gap: var(--cog-space-200);
      }

      .cog-drawer-showcase__search {
        display: grid;
        gap: var(--cog-space-100);
      }

      .cog-drawer-showcase__search-meta {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-075);
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-drawer-showcase__section {
        display: grid;
        gap: 10px;
      }

      .cog-drawer-showcase__section--grow {
        align-content: start;
      }

      .cog-drawer-showcase__section-title {
        margin: 0;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        line-height: var(--cog-lh-overline);
        letter-spacing: var(--cog-ls-overline);
        text-transform: var(--cog-tt-overline);
      }

      .cog-drawer-showcase__list {
        display: grid;
        gap: var(--cog-space-075);
      }

      .cog-drawer-showcase__security {
        display: grid;
        gap: var(--cog-space-075);
      }

      .cog-drawer-showcase__security-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-150);
      }

      .cog-drawer-showcase__security-status {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-100);
        color: var(--cog-text);
      }

      .cog-drawer-showcase__security-icon {
        display: inline-flex;
        width: 28px;
        height: 28px;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-selected-bg);
        color: var(--cog-selected-text);
      }

      .cog-drawer-showcase__security-copy {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }
    `,
  ],
})
export class CognosDrawerShowcaseComponent {
  readonly open = input(true);
  readonly title = input('Cognos');
}
