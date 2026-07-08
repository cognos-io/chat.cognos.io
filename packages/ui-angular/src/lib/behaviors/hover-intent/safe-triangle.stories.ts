import { Component, input } from '@angular/core';

import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { Placement } from './hover-intent-geometry';
import {
  HoverIntentPopoverDirective,
  SafeTriangleDirective,
} from './safe-triangle.directive';

// A self-contained demo of the hover-intent "safe triangle" directive. Hover
// the trigger to open the card; the card sits in the gap below-right of the
// trigger. Move the pointer diagonally toward the card — the translucent
// triangle (the funnel) is the "safe area" that keeps the card open. Move
// perpendicular to it and the card closes immediately.
//
// The funnel overlay is STORY-ONLY debug: it reads the directive's exposed
// `funnel()` signal. Nothing in the shipped directive renders it.
@Component({
  selector: 'cog-safe-triangle-demo',
  standalone: true,
  imports: [SafeTriangleDirective, HoverIntentPopoverDirective],
  template: `
    <div
      class="demo"
      [style.justify-content]="nearEdge() ? 'flex-end' : 'center'"
      [style.align-items]="nearEdge() ? 'flex-end' : 'center'"
    >
      <span
        class="trigger-wrap"
        cogHoverIntent
        #hi="cogHoverIntent"
        [cogHoverIntentGraceMs]="graceMs()"
        [cogHoverIntentPlacement]="placement()"
      >
        <button type="button" class="trigger">i</button>

        @if (hi.opened()) {
          <div class="card" cogHoverIntentPopover role="dialog">
            <strong class="card__title">Minimum wage in Geneva</strong>
            <span class="card__domain">example.com</span>
            <span class="card__snippet">
              The cantonal minimum wage is reviewed periodically and indexed to the cost
              of living.
            </span>
            <a class="card__open" href="#" (click)="$event.preventDefault()"
              >Open source →</a
            >
          </div>
        }
      </span>

      @if (hi.funnel(); as f) {
        <svg class="funnel" aria-hidden="true">
          <polygon
            [attr.points]="
              f[0].x +
              ',' +
              f[0].y +
              ' ' +
              f[1].x +
              ',' +
              f[1].y +
              ' ' +
              f[2].x +
              ',' +
              f[2].y
            "
          />
        </svg>
      }
    </div>
  `,
  styles: `
    .demo {
      position: relative;
      display: flex;
      width: 100%;
      min-height: 340px;
      padding: 24px;
      color: var(--cog-text);
    }
    .trigger-wrap {
      position: relative;
      display: inline-block;
    }
    .trigger {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-hover);
      color: var(--cog-link);
      font-weight: var(--cog-fw-semibold);
      cursor: pointer;
    }
    .card {
      display: grid;
      gap: var(--cog-space-075);
      width: min(320px, 80vw);
      /* Offset so there is a real gap to cross — this is the exact repro of the
         citation card. The directive overrides left/top when it places it. */
      margin-top: 40px;
      margin-left: 40px;
      padding: var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
    }
    .card__title {
      font-size: var(--cog-fs-caption);
    }
    .card__domain {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }
    .card__snippet {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }
    .card__open {
      color: var(--cog-link);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      text-decoration: none;
    }
    .funnel {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 10;
    }
    .funnel polygon {
      fill: color-mix(in srgb, var(--cog-brand) 18%, transparent);
      stroke: var(--cog-brand);
      stroke-width: 1;
    }
  `,
})
class SafeTriangleDemoComponent {
  readonly graceMs = input(500);
  readonly placement = input<Placement>('top');
  readonly nearEdge = input(false);
}

type StoryArgs = {
  graceMs: number;
  placement: Placement;
  nearEdge: boolean;
};

const meta: Meta<StoryArgs> = {
  title: 'Behaviors/Hover intent (safe triangle)',
  decorators: [moduleMetadata({ imports: [SafeTriangleDemoComponent] })],
  argTypes: {
    graceMs: { control: { type: 'number', min: 0, max: 2000, step: 50 } },
    placement: { control: 'select', options: ['top', 'bottom', 'left', 'right'] },
    nearEdge: { control: 'boolean' },
  },
  args: {
    graceMs: 500,
    placement: 'top',
    nearEdge: false,
  },
  render: (args) => ({
    props: args,
    template: `<cog-safe-triangle-demo [graceMs]="graceMs" [placement]="placement" [nearEdge]="nearEdge" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

// Centred trigger. Hover, then move diagonally toward the card through the gap;
// the funnel overlay shows why the card stays open.
export const Default: Story = {};

// Trigger pinned to the bottom-right of the canvas: the card flips above and
// shifts left so it stays fully inside the viewport (no horizontal overflow).
export const NearViewportEdge: Story = {
  args: {
    nearEdge: true,
    placement: 'bottom',
  },
};
