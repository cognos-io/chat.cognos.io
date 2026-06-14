import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconButtonComponent } from '../../primitives/icon-button/icon-button.component';

/**
 * Placeholder navigation control for a forked message (a regenerated response
 * or an edited message). Shows the active branch position and lets the user
 * step between siblings. The visual treatment is intentionally minimal — the
 * final design is being worked on separately; this exists so the branching
 * functionality can be exercised end to end.
 */
@Component({
  selector: 'cog-branch-switcher',
  standalone: true,
  imports: [CognosIconButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-branch-switcher" role="group" aria-label="Switch response">
      <cog-icon-button
        name="chevron-left"
        title="Previous response"
        [disabled]="index() <= 1"
        (click)="previous.emit()"
      />
      <span class="cog-branch-switcher__label">{{ index() }} / {{ count() }}</span>
      <cog-icon-button
        name="chevron-right"
        title="Next response"
        [disabled]="index() >= count()"
        (click)="next.emit()"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-branch-switcher {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-025);
      }

      .cog-branch-switcher__label {
        min-width: 2.5em;
        text-align: center;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class CognosBranchSwitcherComponent {
  /** 1-based position of the active branch. */
  readonly index = input.required<number>();
  /** Total number of sibling branches. */
  readonly count = input.required<number>();

  readonly previous = output<void>();
  readonly next = output<void>();

  // Exposed for templates/tests that want a quick "is this worth showing" check.
  readonly hasBranches = computed(() => this.count() > 1);
}
