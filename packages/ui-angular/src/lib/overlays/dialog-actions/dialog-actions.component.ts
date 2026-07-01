import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type CognosDialogActionsAlign = 'start' | 'center' | 'end' | 'between';
export type CognosDialogActionsMobile = 'inline' | 'stack' | 'split';

// CognosDialogActionsComponent is the footer action row shared by every dialog
// surface (cog-modal / cog-dialog-surface / cog-sheet). It centralises the
// spacing, gap and alignment so consumers only project their buttons and get a
// consistent, correctly-aligned row — instead of each dialog re-declaring the
// same flex rules (and occasionally forgetting them, which leaves buttons as
// baseline-aligned inline-blocks).
//
// Drop it into a footer slot with the matching attribute, e.g.
//   <cog-dialog-actions cogDialogFooter>…buttons…</cog-dialog-actions>
//   <cog-dialog-actions cogModalFooter align="between" mobile="stack">…</cog-dialog-actions>
@Component({
  selector: 'cog-dialog-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
  },
  template: `<ng-content />`,
  styles: [
    `
      :host {
        display: flex;
        width: 100%;
        align-items: center;
        gap: var(--cog-space-100);
      }

      :host(.cog-dialog-actions--start) {
        justify-content: flex-start;
      }

      :host(.cog-dialog-actions--center) {
        justify-content: center;
      }

      :host(.cog-dialog-actions--end) {
        justify-content: flex-end;
      }

      :host(.cog-dialog-actions--between) {
        justify-content: space-between;
      }

      /* On narrow viewports (e.g. a bottom sheet) actions can stack vertically
         or split into two equal columns so touch targets fill the width. */
      @media (max-width: 600px) {
        :host(.cog-dialog-actions--m-stack) {
          flex-direction: column;
          align-items: stretch;
        }

        :host(.cog-dialog-actions--m-split) {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }

        :host(.cog-dialog-actions--m-stack) ::ng-deep cog-button,
        :host(.cog-dialog-actions--m-split) ::ng-deep cog-button {
          display: block;
          width: 100%;
        }

        :host(.cog-dialog-actions--m-stack) ::ng-deep .cog-button,
        :host(.cog-dialog-actions--m-split) ::ng-deep .cog-button {
          width: 100%;
        }
      }
    `,
  ],
})
export class CognosDialogActionsComponent {
  readonly align = input<CognosDialogActionsAlign>('end');
  readonly mobile = input<CognosDialogActionsMobile>('inline');

  protected readonly hostClass = computed(
    () =>
      `cog-dialog-actions cog-dialog-actions--${this.align()} cog-dialog-actions--m-${this.mobile()}`,
  );
}
