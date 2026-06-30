import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { cognosIconNames } from '@cognos/ui/icons';

import {
  CognosIconComponent,
  type CognosIconSize,
  type CognosIconTone,
} from '../../icon/icon.component';

const toneSamples = [
  { label: 'text', tone: 'text' },
  { label: 'subtle', tone: 'text-subtle' },
  { label: 'selected', tone: 'selected' },
  { label: 'link', tone: 'link' },
  { label: 'brand', tone: 'brand' },
  { label: 'success', tone: 'success' },
] as const satisfies ReadonlyArray<{ label: string; tone: CognosIconTone }>;

@Component({
  selector: 'cog-icon-showcase',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="icon-showcase"
      [attr.data-theme]="theme()"
      [attr.data-accent]="accent()"
    >
      <header class="icon-showcase__header">
        <div class="icon-showcase__eyebrow">Lucide iconography</div>
        <h1 class="icon-showcase__title">Canonical Cognos icon set</h1>
        <p class="icon-showcase__description">
          The grid uses the selected size and tone control. The preview row below shows
          the same lock icon across a few semantic token colours.
        </p>
      </header>

      <div class="icon-showcase__tones" aria-label="Icon tone preview">
        @for (sample of samples; track sample.tone) {
          <div class="icon-showcase__tone-card">
            <cog-icon name="lock" [size]="size()" [tone]="sample.tone"></cog-icon>
            <span class="icon-showcase__tone-label">{{ sample.label }}</span>
          </div>
        }
      </div>

      <div class="icon-showcase__grid" aria-label="Available icons">
        @for (iconName of iconNames; track iconName) {
          <article class="icon-showcase__card">
            <cog-icon [name]="iconName" [size]="size()" [tone]="tone()"></cog-icon>
            <span class="icon-showcase__icon-name">{{ iconName }}</span>
          </article>
        }
      </div>
    </section>
  `,
  styles: [
    `
      .icon-showcase {
        display: grid;
        gap: var(--cog-space-300);
        max-width: 1200px;
        padding: var(--cog-space-300);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-app-bg);
        color: var(--cog-text);

        & .icon-showcase__header {
          display: grid;
          gap: var(--cog-space-100);
        }

        & .icon-showcase__eyebrow {
          color: var(--cog-text-subtlest);
          font-size: var(--cog-fs-overline);
          font-weight: var(--cog-fw-overline);
          line-height: var(--cog-lh-overline);
          letter-spacing: var(--cog-ls-overline);
          text-transform: var(--cog-tt-overline);
        }

        & .icon-showcase__title {
          margin: 0;
          font-family: var(--cog-font);
          font-size: var(--cog-fs-h-lg);
          font-weight: var(--cog-fw-h-lg);
          line-height: var(--cog-lh-h-lg);
        }

        & .icon-showcase__description {
          margin: 0;
          max-width: 70ch;
          color: var(--cog-text-subtle);
          font-family: var(--cog-font);
          font-size: var(--cog-fs-body);
          line-height: var(--cog-lh-body);
        }

        & .icon-showcase__tones {
          display: flex;
          flex-wrap: wrap;
          gap: var(--cog-space-150);
        }

        & .icon-showcase__tone-card,
        & .icon-showcase__card {
          border: 1px solid var(--cog-border);
          border-radius: var(--cog-radius-sm);
          background: var(--cog-surface);
        }

        & .icon-showcase__tone-card {
          display: inline-flex;
          align-items: center;
          gap: var(--cog-space-100);
          min-width: 120px;
          padding: 10px var(--cog-space-150);
        }

        & .icon-showcase__tone-label {
          color: var(--cog-text-subtle);
          font-size: var(--cog-fs-caption);
          line-height: var(--cog-lh-caption);
        }

        & .icon-showcase__grid {
          display: grid;
          gap: var(--cog-space-150);
          grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
        }

        & .icon-showcase__card {
          display: grid;
          min-height: 120px;
          justify-items: center;
          gap: var(--cog-space-150);
          padding: var(--cog-space-200) var(--cog-space-150);
          text-align: center;
        }

        & .icon-showcase__icon-name {
          color: var(--cog-text-subtle);
          font-family: var(--cog-font-mono);
          font-size: var(--cog-fs-caption);
          line-height: var(--cog-lh-caption);
        }
      }
    `,
  ],
})
export class CognosIconShowcaseComponent {
  readonly accent = input<'blue' | 'emerald'>('emerald');
  readonly size = input<CognosIconSize>(18);
  readonly theme = input<'dark' | 'light'>('light');
  readonly tone = input<CognosIconTone>('text-subtle');

  protected readonly iconNames = cognosIconNames;
  protected readonly samples = toneSamples;
}
