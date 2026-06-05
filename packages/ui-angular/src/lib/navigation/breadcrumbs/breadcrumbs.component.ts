import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

export type CognosBreadcrumbItem = {
  label: string;
  current?: boolean;
};

@Component({
  selector: "cog-breadcrumbs",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav aria-label="Breadcrumbs" class="cog-breadcrumbs">
      @for (item of items(); track item.label; let index = $index; let last = $last) {
        @if (!isCurrent(item, last)) {
          <button class="cog-breadcrumbs__link" type="button" (click)="onSelect(index)">
            {{ item.label }}
          </button>
        } @else {
          <span class="cog-breadcrumbs__current">{{ item.label }}</span>
        }

        @if (!last) {
          <span aria-hidden="true" class="cog-breadcrumbs__separator">/</span>
        }
      }
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-breadcrumbs {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-075);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      .cog-breadcrumbs__link {
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
          border-radius: var(--cog-radius-xs);
        }
      }

      .cog-breadcrumbs__current {
        color: var(--cog-text);
      }

      .cog-breadcrumbs__separator {
        color: var(--cog-text-subtlest);
      }
    `,
  ],
})
export class CognosBreadcrumbsComponent {
  readonly items = input<CognosBreadcrumbItem[]>([]);
  readonly itemSelect = output<number>();

  protected isCurrent(item: CognosBreadcrumbItem, last: boolean): boolean {
    return item.current ?? last;
  }

  protected onSelect(index: number): void {
    this.itemSelect.emit(index);
  }
}
