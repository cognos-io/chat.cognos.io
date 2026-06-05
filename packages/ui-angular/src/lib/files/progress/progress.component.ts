import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

@Component({
  selector: "cog-progress",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="cog-progress"
      [attr.aria-valuemax]="indeterminate() ? null : 100"
      [attr.aria-valuemin]="indeterminate() ? null : 0"
      [attr.aria-valuenow]="indeterminate() ? null : clampedValue()"
      [attr.role]="indeterminate() ? 'status' : 'progressbar'"
      [style.height.px]="height()"
      [style.--cog-progress-tone]="tone()"
    >
      <span class="cog-progress__fill" [class.cog-progress__fill--indeterminate]="indeterminate()" [style.width.%]="fillWidth()"></span>
    </span>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-progress {
        position: relative;
        display: block;
        width: 100%;
        overflow: hidden;
        border-radius: var(--cog-radius-pill);
        background: color-mix(in srgb, var(--cog-surface-hover) 72%, var(--cog-surface-pressed));
      }

      .cog-progress__fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: var(--cog-progress-tone, var(--cog-brand));
        transition: width 250ms ease-out;
      }

      .cog-progress__fill--indeterminate {
        position: absolute;
        inset-block: 0;
        width: 40%;
        animation: cog-progress-sweep 1.1s ease-in-out infinite alternate;
      }

      @keyframes cog-progress-sweep {
        from {
          inset-inline-start: -12%;
        }

        to {
          inset-inline-start: 72%;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .cog-progress__fill,
        .cog-progress__fill--indeterminate {
          transition: none;
          animation: none;
        }

        .cog-progress__fill--indeterminate {
          inset-inline-start: 0;
          width: 40%;
        }
      }
    `,
  ],
})
export class CognosProgressComponent {
  readonly value = input<number | null>(0);
  readonly indeterminate = input(false);
  readonly height = input(4);
  readonly tone = input("var(--cog-brand)");

  protected readonly clampedValue = computed(() => {
    const value = Number(this.value() ?? 0);
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  });

  protected readonly fillWidth = computed(() =>
    this.indeterminate() ? 40 : this.clampedValue(),
  );
}
