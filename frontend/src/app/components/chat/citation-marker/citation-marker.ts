import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

import {
  CognosIconComponent,
  HoverIntentPopoverDirective,
  SafeTriangleDirective,
} from '@cognos/ui-angular';

import {
  Citation,
  citationDomainLabel,
  sanitizeCitationUrl,
} from '@app/utils/citations';

import { avatarLetter } from '../message-sources/message-sources';

// CitationMarker is the inline, superscript-style numbered chip inserted into an
// answer at a citation anchor (spec docs/specs/web-search.md §4.1a). Hovering,
// focusing or tapping it opens a hover card with the source's letter avatar,
// title, domain, snippet and an "Open source" link. Keyboard accessible
// (focusable chip, Escape closes) and touch friendly (tap toggles). Titles,
// snippets and domains are plain-text bindings; the link is sanitised to
// http(s) and opens with rel="noopener noreferrer".
//
// Instantiated dynamically by RedactedMarkdownComponent (like redaction pills),
// so it is not declared in any imports array. Reusable — an extraction
// candidate for @cognos/ui-angular once a second use appears.
@Component({
  selector: 'app-citation-marker',
  standalone: true,
  imports: [CognosIconComponent, SafeTriangleDirective, HoverIntentPopoverDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="citation-marker" cogHoverIntent #hi="cogHoverIntent">
      <button
        type="button"
        class="citation-marker__chip"
        [attr.aria-expanded]="hi.opened()"
        [attr.aria-label]="chipLabel()"
      >
        {{ number() }}
      </button>

      @if (hi.opened()) {
        <span
          class="citation-marker__card"
          cogHoverIntentPopover
          role="dialog"
          [attr.aria-label]="domain()"
        >
          <span class="citation-marker__head">
            <span class="citation-marker__avatar" aria-hidden="true">{{
              letter()
            }}</span>
            <span class="citation-marker__meta">
              @if (title()) {
                <span class="citation-marker__title">{{ title() }}</span>
              }
              <span class="citation-marker__domain">{{ domain() }}</span>
            </span>
          </span>

          @if (snippet()) {
            <span class="citation-marker__snippet">{{ snippet() }}</span>
          }

          @if (safeUrl(); as href) {
            <a
              class="citation-marker__open"
              [href]="href"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ openLabel() }}
              <cog-icon name="link" [size]="12" />
            </a>
          }
        </span>
      }
    </span>
  `,
  styles: `
    :host {
      display: inline;
    }

    .citation-marker {
      position: relative;
      display: inline-block;
    }

    .citation-marker__chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.15em;
      height: 1.15em;
      margin: 0 0.1em;
      padding: 0 0.3em;
      border: 0;
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-hover);
      color: var(--cog-link);
      font-size: 0.7em;
      font-weight: var(--cog-fw-semibold);
      line-height: 1;
      vertical-align: super;
      cursor: pointer;
    }

    .citation-marker__chip:hover {
      background: var(--cog-brand);
      color: var(--cog-on-brand, #fff);
    }

    .citation-marker__chip:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width);
    }

    .citation-marker__card {
      /* Position (fixed left/top) is owned by the cogHoverIntent directive,
         which keeps the card inside the viewport and drives the hover funnel. */
      position: fixed;
      z-index: 20;
      display: grid;
      gap: var(--cog-space-075);
      width: min(320px, 80vw);
      padding: var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
      text-align: left;
    }

    .citation-marker__head {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
    }

    .citation-marker__avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      flex: none;
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-hover);
      color: var(--cog-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      line-height: 1;
    }

    .citation-marker__meta {
      display: grid;
      min-width: 0;
    }

    .citation-marker__title {
      overflow: hidden;
      color: var(--cog-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-caption);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .citation-marker__domain {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .citation-marker__snippet {
      display: -webkit-box;
      overflow: hidden;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;
    }

    .citation-marker__open {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-link);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      text-decoration: none;
    }

    .citation-marker__open:hover {
      text-decoration: underline;
    }
  `,
})
export class CitationMarker {
  private readonly _transloco = inject(TranslocoService);

  // 0-based citation index; the chip renders the 1-based number.
  readonly index = input.required<number>();
  readonly citation = input.required<Citation>();

  protected readonly number = computed(() => this.index() + 1);
  protected readonly title = computed(() => (this.citation().title ?? '').trim());
  protected readonly snippet = computed(() => (this.citation().snippet ?? '').trim());
  // The proxy-redirect host is never shown; a title-less proxy source falls back
  // to a localised generic label instead (spec §4.1a).
  protected readonly domain = computed(
    () =>
      citationDomainLabel(this.citation()) ||
      this._transloco.translate('chat.message.sources.webResult'),
  );
  protected readonly letter = computed(() => avatarLetter(this.domain()));
  protected readonly safeUrl = computed(() => sanitizeCitationUrl(this.citation().url));
  protected readonly openLabel = computed(() =>
    this._transloco.translate('chat.message.sources.open'),
  );
  protected readonly chipLabel = computed(() =>
    this._transloco.translate('chat.message.sources.marker', {
      number: this.number(),
      domain: this.domain(),
    }),
  );
}
