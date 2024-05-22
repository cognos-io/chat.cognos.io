import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { Tag } from '@app/interfaces/tag';

@Component({
  selector: 'app-tag',
  standalone: true,
  imports: [CommonModule],
  template: `<span
    class="pill inline-flex items-center gap-x-1.5 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset"
    [ngClass]="tagColorClass"
  >
    @if (tag.featured) {
      <svg
        class="featured h-1.5 w-1.5"
        viewBox="0 0 6 6"
        aria-hidden="true"
        [ngClass]="tagColorClass"
      >
        <circle cx="3" cy="3" r="3" />
      </svg>
    }

    {{ tag.title }}</span
  >`,
  styles: `
    .grey {
      &.pill {
        @apply bg-gray-400/10 text-gray-400 ring-gray-400/20;
      }
      &.featured {
        @apply fill-gray-400;
      }
    }

    .primary {
      &.pill {
        @apply bg-green-50 text-green-700 ring-green-600/20;
      }

      &.featured {
        @apply fill-green-700;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TagComponent {
  @Input({ required: true }) tag!: Tag;

  get tagColorClass() {
    return this.tag.color?.palette ?? 'grey';
  }
}
