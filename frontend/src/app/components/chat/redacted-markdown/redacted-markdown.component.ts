import {
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  createComponent,
  effect,
  inject,
  input,
} from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';
import { MarkdownComponent } from 'ngx-markdown';

import {
  CognosRedactedTextComponent,
  type CognosRedactedTextKind,
} from '@cognos/ui-angular';

import { RedactionEntry, RedactionType } from '@app/redaction';
import { ConversationService } from '@app/services/conversation.service';
import { RedactionService } from '@app/services/redaction.service';

import { injectRedactionPills } from './redaction-pills';

// Detector type → the pill's visual kind. Anything without a dedicated icon
// renders as a labelled "custom" pill.
const TYPE_KIND: Partial<Record<RedactionType, CognosRedactedTextKind>> = {
  email: 'email',
  phone: 'phone',
  person: 'name',
};

/**
 * Renders redacted message content with full markdown, then replaces each
 * placeholder token in the rendered output with a `cog-redacted-text` pill so
 * the reader can SEE what was redacted (and, on click, that the model only ever
 * received a placeholder). Stored content is never mutated — this is a display
 * layer over the already-redacted text.
 *
 * Implementation: markdown renders the tokens as literal text; after each
 * render we walk the resulting text nodes and swap tokens for live component
 * instances. This preserves all markdown structure (headings, lists, code)
 * around the pills, which a naive split-and-rejoin would break.
 */
@Component({
  selector: 'app-redacted-markdown',
  standalone: true,
  imports: [MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<markdown emoji katex [data]="content()" (ready)="hydratePills()" />`,
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

  /** The stored, redacted content (tokens intact — NOT hydrated). */
  readonly content = input.required<string>();

  // Each injected pill, with the host element it replaced the token text with
  // and the token it stands for — so clearPills can restore the DOM to its
  // raw-token state, keeping hydratePills idempotent across repeat calls.
  private _pills: {
    ref: ComponentRef<CognosRedactedTextComponent>;
    host: HTMLElement;
    token: string;
  }[] = [];

  constructor() {
    // Mappings load asynchronously; when they arrive (revision bumps), re-run
    // the swap so tokens that were raw become pills.
    effect(() => {
      this._redaction.revision();
      this.content();
      queueMicrotask(() => this.hydratePills());
    });
    inject(DestroyRef).onDestroy(() => this.clearPills());
  }

  // hydratePills replaces every known token in the rendered markdown with a pill
  // component. Called on (ready) and whenever the entry map changes.
  hydratePills(): void {
    this.clearPills();

    const markdownEl = this._host.nativeElement.querySelector('markdown');
    if (!markdownEl) {
      return;
    }
    const entries = this._redaction.entriesFor(
      this._conversation.conversation()?.record.id,
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

  private createPill(token: string, entry: RedactionEntry): HTMLElement {
    const ref = createComponent(CognosRedactedTextComponent, {
      environmentInjector: this._envInjector,
    });
    ref.setInput('value', entry.original);
    ref.setInput('placeholder', entry.token);
    ref.setInput('kind', TYPE_KIND[entry.type] ?? 'custom');
    ref.setInput(
      'label',
      this._transloco.translate(`chat.composer.redaction.types.${entry.type}`),
    );
    ref.setInput('showSettings', false);
    this._appRef.attachView(ref.hostView);
    const host = ref.location.nativeElement as HTMLElement;
    this._pills.push({ ref, host, token });
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
}
