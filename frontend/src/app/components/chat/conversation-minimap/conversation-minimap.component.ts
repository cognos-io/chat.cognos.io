import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosConversationMinimapComponent,
  type MinimapTick as CognosMinimapTick,
} from '@cognos/ui-angular';

import { MessageService } from '@app/services/message.service';

import { deriveMinimapTicks, pickActiveTickId } from './minimap';

/**
 * Thin app container for the chat minimap. It reads `MessageService.messages`
 * (the active-branch signal) to derive the user-turn ticks and tracks the
 * "you are here" tick via an IntersectionObserver, then hands localised copy to
 * the presentational `cog-conversation-minimap`. Desktop-only styling and the
 * "render nothing when ≤1 tick" rule live in the library component.
 */
@Component({
  selector: 'app-conversation-minimap',
  standalone: true,
  imports: [TranslocoModule, CognosConversationMinimapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-conversation-minimap
      *transloco="let t"
      [ticks]="toMinimapTicks(t)"
      [activeId]="activeId()"
      [navLabel]="t('chat.minimap.label')"
      (jump)="jumpTo.emit($event)"
    />
  `,
})
export class ConversationMinimapComponent {
  private readonly _messageService = inject(MessageService);

  /** Emits the record id of the tick the user clicked. */
  readonly jumpTo = output<string>();

  readonly ticks = computed(() => deriveMinimapTicks(this._messageService.messages()));

  /** The "you are here" tick, tracked from what's visible in the viewport. */
  readonly activeId = signal<string | null>(null);

  /** Map the derived ticks to the library shape, folding in localised copy. */
  toMinimapTicks(t: (key: string, params?: object) => string): CognosMinimapTick[] {
    const noPreview = t('chat.minimap.noPreview');
    return this.ticks().map((tick) => {
      const preview = tick.preview || noPreview;
      return {
        id: tick.id,
        preview,
        ariaLabel: t('chat.minimap.jumpTo', { preview }),
      };
    });
  }

  constructor() {
    // Re-observe whenever the ticks change (new turn, branch switch). Cleaned up
    // by the previous run's onCleanup, so only one observer is ever live.
    effect((onCleanup) => {
      const ticks = this.ticks();
      if (typeof IntersectionObserver === 'undefined' || ticks.length === 0) {
        this.activeId.set(null);
        return;
      }
      const orderedIds = ticks.map((tick) => tick.id);
      const visible = new Set<string>();
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) {
            visible.add(id);
          } else {
            visible.delete(id);
          }
        }
        this.activeId.set(pickActiveTickId(orderedIds, visible));
      });
      // Defer one frame so freshly-rendered message elements are in the DOM.
      const raf = requestAnimationFrame(() => {
        for (const id of orderedIds) {
          const el = document.getElementById(id);
          if (el) {
            observer.observe(el);
          }
        }
      });
      onCleanup(() => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      });
    });
  }
}
