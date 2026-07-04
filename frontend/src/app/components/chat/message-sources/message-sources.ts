import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { CognosIconComponent } from '@cognos/ui-angular';

import {
  Citation,
  citationAvatarLetter,
  citationDomainLabel,
  sanitizeCitationUrl,
} from '@app/utils/citations';

// A citation prepared for display: the raw source plus its derived, sanitised
// presentation fields, so the template binds plain values only.
interface DisplayCitation {
  number: number;
  letter: string;
  title: string;
  domain: string;
  snippet: string;
  href: string | null;
}

// MessageSources is the "Searched N sources" disclosure shown at the top of an
// assistant message (spec docs/specs/web-search.md §4.1a). Collapsed by default;
// a chevron expands the list. Each row is a whole-row link to the source with a
// letter avatar, citation number, title, domain and one-line snippet. Titles,
// snippets and domains are plain-text bindings; links are sanitised to http(s)
// and open in a new tab with rel="noopener noreferrer".
@Component({
  selector: 'app-message-sources',
  standalone: true,
  imports: [CognosIconComponent, TranslocoModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="message-sources" *transloco="let t">
      <button
        type="button"
        class="message-sources__trigger"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <cog-icon name="search" [size]="14" tone="link" />
        <span class="message-sources__count">{{ countLabel() }}</span>
        <cog-icon
          [name]="open() ? 'chevron-down' : 'chevron-right'"
          [size]="14"
          tone="link"
        />
      </button>

      @if (open()) {
        <ul class="message-sources__list">
          @for (source of displaySources(); track source.number) {
            <li>
              @if (source.href; as href) {
                <a
                  class="message-sources__row"
                  [href]="href"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ng-container
                    *ngTemplateOutlet="rowBody; context: { $implicit: source }"
                  />
                </a>
              } @else {
                <div class="message-sources__row message-sources__row--static">
                  <ng-container
                    *ngTemplateOutlet="rowBody; context: { $implicit: source }"
                  />
                </div>
              }
            </li>
          }
        </ul>
      }

      <ng-template #rowBody let-source>
        <span class="message-sources__avatar" aria-hidden="true">{{
          source.letter
        }}</span>
        <span class="message-sources__body">
          <span class="message-sources__heading">
            <span class="message-sources__number">{{ source.number }}</span>
            @if (source.title) {
              <span class="message-sources__title">{{ source.title }}</span>
            }
            <span class="message-sources__domain">{{ source.domain }}</span>
          </span>
          @if (source.snippet) {
            <span class="message-sources__snippet">{{ source.snippet }}</span>
          }
        </span>
        @if (source.href) {
          <cog-icon name="link" [size]="14" tone="text-subtle" />
        }
      </ng-template>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .message-sources {
      display: grid;
      gap: var(--cog-space-075);
    }

    .message-sources__trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      align-self: start;
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--cog-link);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      cursor: pointer;
    }

    .message-sources__trigger:focus-visible {
      outline: 2px solid var(--cog-brand);
      outline-offset: 2px;
      border-radius: var(--cog-radius-xs);
    }

    .message-sources__count {
      font-weight: var(--cog-fw-semibold);
    }

    .message-sources__list {
      display: grid;
      gap: var(--cog-space-075);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .message-sources__row {
      display: flex;
      align-items: flex-start;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-075) var(--cog-space-100);
      background: var(--cog-surface);
      color: inherit;
      text-decoration: none;
    }

    a.message-sources__row:hover {
      border-color: var(--cog-border-bold);
      background: var(--cog-surface-hover);
    }

    a.message-sources__row:focus-visible {
      outline: 2px solid var(--cog-brand);
      outline-offset: 2px;
    }

    .message-sources__avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: none;
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-hover);
      color: var(--cog-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      line-height: 1;
    }

    .message-sources__body {
      display: grid;
      gap: var(--cog-space-025);
      min-width: 0;
      flex: 1;
    }

    .message-sources__heading {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--cog-space-075);
    }

    .message-sources__number {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
    }

    .message-sources__title {
      overflow: hidden;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message-sources__domain {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .message-sources__snippet {
      display: -webkit-box;
      overflow: hidden;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
    }
  `,
})
export class MessageSources {
  private readonly _transloco = inject(TranslocoService);

  readonly citations = input<Citation[]>([]);

  protected readonly open = signal(false);

  protected readonly displaySources = computed<DisplayCitation[]>(() =>
    this.citations().map((citation, index) => ({
      number: index + 1,
      letter: citationAvatarLetter(citation),
      title: (citation.title ?? '').trim(),
      domain: citationDomainLabel(citation),
      snippet: (citation.snippet ?? '').trim(),
      href: sanitizeCitationUrl(citation.url),
    })),
  );

  protected readonly countLabel = computed(() => {
    const count = this.citations().length;
    return this._transloco.translate(
      count === 1
        ? 'chat.message.sources.searchedOne'
        : 'chat.message.sources.searchedOther',
      { count },
    );
  });

  protected toggle(): void {
    this.open.update((value) => !value);
  }
}
