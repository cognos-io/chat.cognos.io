import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import { CognosButtonComponent } from "../../button/button.component";
import { CognosIconComponent } from "../../icon/icon.component";
import { CognosIconButtonComponent } from "../../primitives/icon-button/icon-button.component";

@Component({
  selector: "cog-composer",
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconComponent,
    CognosIconButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cog-composer">
      <div class="cog-composer__panel">
        <textarea
          class="cog-composer__input"
          [disabled]="disabled()"
          [placeholder]="placeholder()"
          [value]="value()"
          rows="3"
          (input)="onInput($event)"
        ></textarea>

        <div class="cog-composer__toolbar">
          <div class="cog-composer__tools">
            <cog-button appearance="default" type="button" (click)="onOpenModel()">
              {{ modelLabel() }}
              <cog-icon name="chevron-down" [size]="16" tone="text-subtle" />
            </cog-button>

            <cog-icon-button name="book-text" title="Prompts" (click)="onOpenPrompts()" />
            <cog-icon-button name="sparkles" title="Skills" (click)="onOpenSkills()" />
            <cog-icon-button name="paperclip" title="Attach file" (click)="onAttach()" />
          </div>

          <cog-button
            appearance="primary"
            type="button"
            [disabled]="disabled() || sendDisabled()"
            (click)="onSend()"
          >
            <cog-icon name="send" [size]="16" tone="current" />
            Send
          </cog-button>
        </div>
      </div>

      <div class="cog-composer__caption">
        <cog-icon name="lock" [size]="12" tone="text-subtlest" />
        <span>{{ securityText() }}</span>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-composer {
        display: grid;
        gap: var(--cog-space-100);
      }

      .cog-composer__panel {
        display: grid;
        gap: var(--cog-space-150);
        border: 2px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: var(--cog-space-150);
        transition: border-color var(--cog-dur-fast) var(--cog-ease-standard);

        &:focus-within {
          border-color: var(--cog-brand);
        }
      }

      .cog-composer__input {
        width: 100%;
        resize: none;
        border: 0;
        background: transparent;
        color: var(--cog-text);
        font: inherit;
        font-size: 16px;
        line-height: var(--cog-lh-body-lg);
        outline: 0;
      }

      .cog-composer__toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--cog-space-100);
      }

      .cog-composer__tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-050);
      }

      .cog-composer__caption {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-050);
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      @media (min-width: 768px) {
        .cog-composer__input {
          font-size: var(--cog-fs-body-lg);
        }
      }
    `,
  ],
})
export class CognosComposerComponent {
  readonly value = input("");
  readonly placeholder = input("Ask Cognos anything secure…");
  readonly modelLabel = input("This device");
  readonly securityText = input(
    "End-to-end encrypted · keys never leave this device",
  );
  readonly disabled = input(false);
  readonly sendDisabled = input(false);
  readonly valueChange = output<string>();
  readonly send = output<void>();
  readonly openModel = output<void>();
  readonly openPrompts = output<void>();
  readonly openSkills = output<void>();
  readonly attach = output<void>();

  protected onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.valueChange.emit(target.value);
  }

  protected onSend(): void {
    this.send.emit();
  }

  protected onOpenModel(): void {
    this.openModel.emit();
  }

  protected onOpenPrompts(): void {
    this.openPrompts.emit();
  }

  protected onOpenSkills(): void {
    this.openSkills.emit();
  }

  protected onAttach(): void {
    this.attach.emit();
  }
}
