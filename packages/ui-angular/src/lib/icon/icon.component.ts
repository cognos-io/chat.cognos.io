import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";
import { DomSanitizer, type SafeHtml } from "@angular/platform-browser";
import {
  getCognosIcon,
  type CognosIconName,
  type CognosIconNode,
} from "@cognos/ui/icons";

export type CognosIconSize = number;
export type CognosIconTone =
  | "current"
  | "text"
  | "text-subtle"
  | "text-subtlest"
  | "selected"
  | "link"
  | "brand"
  | "success"
  | "danger";

@Component({
  selector: "cog-icon",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [class]="iconClass()"
      [style.--cog-icon-size.px]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      [attr.role]="title() ? 'img' : 'presentation'"
      [attr.aria-hidden]="title() ? null : 'true'"
      [innerHTML]="svgMarkup()"
    ></svg>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        line-height: 0;
        vertical-align: middle;
      }

      .cog-icon {
        display: block;
        width: var(--cog-icon-size, 16px);
        height: var(--cog-icon-size, 16px);
        flex: none;
        stroke-width: var(--cog-icon-stroke);

        &.cog-icon--tone-current {
          color: currentColor;
        }

        &.cog-icon--tone-text {
          color: var(--cog-text);
        }

        &.cog-icon--tone-text-subtle {
          color: var(--cog-text-subtle);
        }

        &.cog-icon--tone-text-subtlest {
          color: var(--cog-text-subtlest);
        }

        &.cog-icon--tone-selected {
          color: var(--cog-selected-text);
        }

        &.cog-icon--tone-link {
          color: var(--cog-link);
        }

        &.cog-icon--tone-brand {
          color: var(--cog-brand);
        }

        &.cog-icon--tone-success {
          color: var(--cog-success-text);
        }

        &.cog-icon--tone-danger {
          color: var(--cog-danger);
        }
      }
    `,
  ],
})
export class CognosIconComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly name = input<CognosIconName>("lock");
  readonly size = input<CognosIconSize>(16, { transform: iconSizeAttribute });
  readonly title = input<string | null>(null);
  readonly tone = input<CognosIconTone>("current");

  protected readonly iconClass = computed(
    () =>
      `cog-icon cog-icon--size-${this.size()} cog-icon--tone-${this.tone()}`,
  );

  protected readonly svgMarkup = computed<SafeHtml>(() => {
    const icon = getCognosIcon(this.name());
    return this.sanitizer.bypassSecurityTrustHtml(
      renderIconMarkup(icon, this.title()),
    );
  });
}

type IconElement = CognosIconNode[number];

function iconSizeAttribute(value: unknown): CognosIconSize {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }

  return 16;
}

function renderIconMarkup(
  icon: CognosIconNode,
  title: string | null,
): string {
  const titleMarkup = title ? `<title>${escapeHtml(title)}</title>` : "";
  const iconMarkup = icon.map(renderIconElement).join("");

  return `${titleMarkup}${iconMarkup}`;
}

function renderIconElement([tag, attrs]: IconElement): string {
  const attributes = Object.entries(attrs)
    .map(([name, value]) => `${name}="${escapeHtml(String(value))}"`)
    .join(" ");

  return `<${tag} ${attributes}></${tag}>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
