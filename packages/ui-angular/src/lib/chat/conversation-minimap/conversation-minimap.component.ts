import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import {
  HoverIntentPopoverDirective,
  SafeTriangleDirective,
} from '../../behaviors/hover-intent/safe-triangle.directive';

/**
 * A single minimap tick: one navigable turn in the chat, with a short text
 * preview shown on hover and an accessible label. All copy (preview text and
 * `ariaLabel`) is prepared by the host app so this library component stays
 * translation-free.
 */
export interface MinimapTick {
  /** Stable id of the target turn — echoed back on `jump`. */
  id: string;
  /** Collapsed, truncated text preview shown on hover/focus. */
  preview: string;
  /** Localised accessible label for the tick button. */
  ariaLabel: string;
}

/**
 * A slim vertical rail of ticks on the right of the chat — one per navigable
 * turn. Hovering (or focusing) a tick opens a preview tooltip via the shared
 * hover-intent behaviour (`cogHoverIntent`), which owns the popover position,
 * keeps it inside the viewport and drives the safe-triangle funnel; clicking a
 * tick emits `jump` with its id. Purely presentational: the host supplies the
 * ticks (with localised copy) and tracks which one is active. Renders nothing
 * when there are one or fewer ticks. Desktop-only: it lives in the gutter beside
 * the chat column, which doesn't exist on narrow screens (hidden via a media
 * query).
 */
@Component({
  selector: 'cog-conversation-minimap',
  standalone: true,
  imports: [SafeTriangleDirective, HoverIntentPopoverDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ticks().length > 1) {
      <nav
        class="minimap"
        [attr.aria-label]="navLabel()"
        data-testid="conversation-minimap"
      >
        @for (tick of ticks(); track tick.id) {
          <button
            type="button"
            class="minimap__tick"
            cogHoverIntent
            cogHoverIntentPlacement="left"
            #hi="cogHoverIntent"
            [class.minimap__tick--active]="tick.id === activeId()"
            (click)="jump.emit(tick.id)"
            [attr.aria-label]="tick.ariaLabel"
            [attr.title]="tick.preview"
            data-testid="minimap-tick"
          >
            <span class="minimap__line" aria-hidden="true"></span>
            @if (hi.opened()) {
              <span
                class="minimap__preview"
                cogHoverIntentPopover
                data-testid="minimap-preview"
                role="tooltip"
                >{{ tick.preview }}</span
              >
            }
          </button>
        }
      </nav>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: 20%;
      bottom: 20%;
      right: var(--cog-space-050);
      z-index: 2;
      pointer-events: none;
      display: flex;
      align-items: center;
    }

    .minimap {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-050);
      align-items: flex-end;
      max-height: 60vh;
      pointer-events: auto;
    }

    .minimap__tick {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      position: relative;
      padding: var(--cog-space-025) var(--cog-space-050);
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .minimap__line {
      display: block;
      width: 18px;
      height: 2px;
      border-radius: var(--cog-radius-pill);
      background: var(--cog-border);
      transition:
        width var(--cog-dur-fast) var(--cog-ease-standard),
        background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .minimap__tick:hover .minimap__line,
    .minimap__tick:focus-visible .minimap__line {
      width: 26px;
      background: var(--cog-text-subtle);
    }

    .minimap__tick--active .minimap__line {
      width: 26px;
      background: var(--cog-text);
    }

    .minimap__preview {
      /* Position (fixed left/top) is owned by the cogHoverIntent directive,
         which keeps the card inside the viewport and drives the hover funnel. */
      position: fixed;
      z-index: 20;
      width: min(20rem, 80vw);
      padding: var(--cog-space-075) var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
      color: var(--cog-text);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      text-align: left;
      white-space: normal;
      overflow-wrap: break-word;
    }

    /* Desktop-only: no gutter beside the chat column on narrow screens. */
    @media (max-width: 900px) {
      :host {
        display: none;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .minimap__line {
        transition: none;
      }
    }
  `,
})
export class CognosConversationMinimapComponent {
  /** The ticks to render (with localised preview + accessible label). */
  readonly ticks = input<MinimapTick[]>([]);
  /** The "you are here" tick id, tracked by the host from the viewport. */
  readonly activeId = input<string | null>(null);
  /** Localised accessible label for the nav rail. */
  readonly navLabel = input<string>('');

  /** Emits the id of the tick the user clicked. */
  readonly jump = output<string>();
}
