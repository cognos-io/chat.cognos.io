import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  computed,
  createComponent,
  effect,
  inject,
  input,
} from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { MarkdownComponent } from 'ngx-markdown';

import { CognosRedactedTextComponent } from '@cognos/ui-angular';

import { RedactionEntry } from '@app/redaction';
import { ConversationService } from '@app/services/conversation.service';
import { RedactionService } from '@app/services/redaction.service';
import {
  Citation,
  CitationAnchor,
  citationMarkerToken,
  injectCitationMarkers,
  insertCitationMarkers,
} from '@app/utils/citations';

import { BookmarkAnchor } from '../bookmark-highlight/bookmark-anchor';
import { rangeForAnchor } from '../bookmark-highlight/bookmark-dom';
import { BookmarkHighlightService } from '../bookmark-highlight/bookmark-highlight.service';
import { CitationMarker } from '../citation-marker/citation-marker';
import {
  redactionKindFor,
  redactionModalLabels,
  redactionTypeLabel,
} from '../redaction-ui';
import { injectRedactionPills } from './redaction-pills';

/**
 * Renders redacted message content with full markdown, then replaces each
 * placeholder token in the rendered output with a `cog-redacted-text` pill so
 * the reader can SEE what was redacted (and, on click, that the model only ever
 * received a placeholder). Stored content is never mutated — this is a display
 * layer over the already-redacted text.
 *
 * When web-search `citations`/`citationAnchors` are supplied (see
 * docs/business_processes/web-search.md), numbered citation-marker tokens are inserted
 * into the RAW markdown at the anchor offsets BEFORE rendering (offsets index
 * the source, not the rendered DOM), then hydrated into interactive
 * `app-citation-marker` chips after render — the same token/hydrate strategy as
 * redaction pills.
 *
 * Implementation: markdown renders the tokens as literal text; after each
 * render we walk the resulting text nodes and swap tokens for live component
 * instances. This preserves all markdown structure (headings, lists, code)
 * around the pills and chips, which a naive split-and-rejoin would break.
 */
@Component({
  selector: 'app-redacted-markdown',
  standalone: true,
  imports: [MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<markdown emoji katex [data]="renderedContent()" (ready)="render()" />`,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class RedactedMarkdownComponent {
  private readonly _redaction = inject(RedactionService);
  private readonly _conversation = inject(ConversationService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _appRef = inject(ApplicationRef);
  private readonly _envInjector = inject(EnvironmentInjector);
  private readonly _transloco = inject(TranslocoService);
  private readonly _highlight = inject(BookmarkHighlightService);

  /** The stored, redacted content (tokens intact — NOT hydrated). */
  readonly content = input.required<string>();

  /** Web-search sources cited by this message (empty → no inline markers). */
  readonly citations = input<Citation[]>([]);
  /** Inline anchors positioning citation markers in `content` (code points). */
  readonly citationAnchors = input<CitationAnchor[]>([]);
  /** Saved-bookmark anchors to paint over this message's rendered text. */
  readonly bookmarks = input<BookmarkAnchor[]>([]);

  // The content actually rendered: raw content with citation-marker tokens
  // spliced in at the anchor offsets. Identical to `content` when there are no
  // anchors, so non-search messages are byte-for-byte unchanged.
  protected readonly renderedContent = computed(() =>
    insertCitationMarkers(
      this.content(),
      this.citationAnchors(),
      this.citations().length,
    ),
  );

  // Each injected pill, with the host element it replaced the token text with
  // and the token it stands for — so clearPills can restore the DOM to its
  // raw-token state, keeping hydratePills idempotent across repeat calls.
  private _pills: {
    ref: ComponentRef<CognosRedactedTextComponent>;
    host: HTMLElement;
    token: string;
  }[] = [];

  // Each injected citation chip, with the host it replaced the token with and
  // the citation index it stands for — so clearCiteChips can restore the token
  // text, keeping hydration idempotent across repeat calls.
  private _citeChips: {
    ref: ComponentRef<CitationMarker>;
    host: HTMLElement;
    index: number;
  }[] = [];

  constructor() {
    // Mappings load asynchronously; when they arrive (revision bumps), re-run
    // the swap so tokens that were raw become pills. Also re-run when citations
    // or anchors change so late-arriving sources hydrate their markers.
    effect(() => {
      this._redaction.revision();
      this._redaction.valuesHidden();
      this.renderedContent();
      this.citations();
      this.bookmarks();
      queueMicrotask(() => this.render());
    });
    inject(DestroyRef).onDestroy(() => {
      this.clearPills();
      this.clearCiteChips();
      this._highlight.unregister(this);
    });
  }

  // render runs the post-render passes in order: redaction pills, then citation
  // markers, then bookmark highlights LAST so they anchor over the FINAL text
  // (pills/chips reshape it). Called on markdown (ready) and whenever inputs
  // change.
  render(): void {
    this.hydratePills();
    this.hydrateCitations();
    this.hydrateBookmarks();
  }

  // hydrateBookmarks locates each saved anchor in the rendered text and paints a
  // Range for it via the CSS Custom Highlight API. The root is this component's
  // host element — the SAME element the capture side anchors against, so offsets
  // stay consistent. Anchors that no longer match (edited/re-redacted content)
  // are dropped silently.
  private hydrateBookmarks(): void {
    const anchors = this.bookmarks();
    if (anchors.length === 0) {
      this._highlight.unregister(this);
      return;
    }
    const root = this._host.nativeElement;
    const ranges = anchors
      .map((anchor) => rangeForAnchor(root, anchor))
      .filter((range): range is Range => !!range);
    this._highlight.register(this, ranges);
  }

  // hydratePills replaces every known token in the rendered markdown with a pill
  // component. Called on (ready) and whenever the entry map changes.
  hydratePills(): void {
    this.clearPills();

    const markdownEl = this._host.nativeElement.querySelector('markdown');
    if (!markdownEl) {
      return;
    }
    const conversation = this._conversation.conversation();
    const entries = this._redaction.combinedEntriesFor(
      conversation?.record.id,
      conversation?.record.project,
    );
    if (entries.size === 0) {
      return;
    }

    injectRedactionPills(
      markdownEl,
      (token) => entries.has(token),
      (token) => this.createPill(token, entries.get(token) as RedactionEntry),
    );
  }

  // hydrateCitations replaces every citation-marker token with a chip component.
  private hydrateCitations(): void {
    this.clearCiteChips();

    const citations = this.citations();
    if (citations.length === 0) {
      return;
    }
    const markdownEl = this._host.nativeElement.querySelector('markdown');
    if (!markdownEl) {
      return;
    }

    injectCitationMarkers(markdownEl, (index) => this.createCiteChip(index, citations));
  }

  private createPill(token: string, entry: RedactionEntry): HTMLElement {
    const ref = createComponent(CognosRedactedTextComponent, {
      environmentInjector: this._envInjector,
    });
    ref.setInput('value', entry.original);
    ref.setInput('placeholder', entry.token);
    ref.setInput('kind', redactionKindFor(entry.type));
    ref.setInput('label', redactionTypeLabel(this._transloco, entry.type));
    ref.setInput('labels', redactionModalLabels(this._transloco));
    ref.setInput('showSettings', false);
    ref.setInput('masked', this._redaction.valuesHidden());
    this._appRef.attachView(ref.hostView);
    const host = ref.location.nativeElement as HTMLElement;
    this._pills.push({ ref, host, token });
    return host;
  }

  // createCiteChip builds a citation-marker chip for a citation index. Out-of-
  // range indices (marker token referencing a missing citation) leave the token
  // text in place rather than rendering a broken chip.
  private createCiteChip(index: number, citations: Citation[]): Node {
    const citation = citations[index];
    if (!citation) {
      return document.createTextNode('');
    }
    const ref = createComponent(CitationMarker, {
      environmentInjector: this._envInjector,
    });
    ref.setInput('index', index);
    ref.setInput('citation', citation);
    this._appRef.attachView(ref.hostView);
    const host = ref.location.nativeElement as HTMLElement;
    this._citeChips.push({ ref, host, index });
    return host;
  }

  // clearPills restores each pill's host back to the raw token text before
  // destroying the component, so a subsequent hydratePills() pass sees the
  // tokens again and can re-inject. Without this, a second pass would destroy
  // the pills and leave empty host shells (the token already gone), blanking
  // the redacted value — notably after switching conversations and back.
  private clearPills(): void {
    for (const { ref, host, token } of this._pills) {
      host.parentNode?.replaceChild(document.createTextNode(token), host);
      this._appRef.detachView(ref.hostView);
      ref.destroy();
    }
    this._pills = [];
  }

  // clearCiteChips mirrors clearPills for citation markers, restoring the token
  // text so a subsequent hydration pass can re-inject.
  private clearCiteChips(): void {
    for (const { ref, host, index } of this._citeChips) {
      host.parentNode?.replaceChild(
        document.createTextNode(citationMarkerToken(index)),
        host,
      );
      this._appRef.detachView(ref.hostView);
      ref.destroy();
    }
    this._citeChips = [];
  }
}
