import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import {
  CognosBreadcrumbItem,
  CognosBreadcrumbsComponent,
} from '../breadcrumbs/breadcrumbs.component';

/**
 * CognosPageHeaderComponent (`cog-page-header`) is the standard top-of-page
 * header: optional breadcrumbs, a title, an optional subtitle, and a trailing
 * actions slot. It centralises the breadcrumb + title + subtitle spacing/
 * typography so settings, projects, personas, billing, etc. share one header.
 *
 *   <cog-page-header [breadcrumbs]="crumbs" [title]="'Projects'" [subtitle]="'…'">
 *     <cog-button page-header-actions>New project</cog-button>
 *   </cog-page-header>
 *
 * Route-specific breadcrumb construction stays with the host.
 */
@Component({
  selector: 'cog-page-header',
  standalone: true,
  imports: [CognosBreadcrumbsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cog-page-header">
      @if (breadcrumbs().length) {
        <cog-breadcrumbs [items]="breadcrumbs()" />
      }
      <div class="cog-page-header__bar">
        <div class="cog-page-header__text">
          @if (title()) {
            <h1 class="cog-page-header__title">{{ title() }}</h1>
          }
          @if (subtitle()) {
            <p class="cog-page-header__subtitle">{{ subtitle() }}</p>
          }
        </div>
        <div class="cog-page-header__actions">
          <ng-content select="[page-header-actions]" />
        </div>
      </div>
    </header>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-page-header {
        display: grid;
        gap: var(--cog-space-050);
        margin: var(--cog-space-150) 0 0;
      }

      .cog-page-header__bar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cog-space-150);
      }

      .cog-page-header__text {
        display: grid;
        gap: var(--cog-space-050);
        min-width: 0;
      }

      .cog-page-header__title {
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-h-lg);
        font-weight: var(--cog-fw-h-lg);
      }

      .cog-page-header__subtitle {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        text-wrap: pretty;
      }

      .cog-page-header__actions {
        display: flex;
        flex: none;
        align-items: center;
        gap: var(--cog-space-100);
      }

      .cog-page-header__actions:empty {
        display: none;
      }
    `,
  ],
})
export class CognosPageHeaderComponent {
  readonly breadcrumbs = input<CognosBreadcrumbItem[]>([]);
  readonly title = input('');
  readonly subtitle = input('');
}
