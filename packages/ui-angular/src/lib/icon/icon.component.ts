import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  viewChild,
} from '@angular/core';

import {
  type CognosIconName,
  type CognosIconNode,
  getCognosIcon,
} from '@cognos/ui/icons';

export type CognosIconSize = number;
export type CognosIconTone =
  | 'current'
  | 'text'
  | 'text-subtle'
  | 'text-subtlest'
  | 'selected'
  | 'link'
  | 'brand'
  | 'success'
  | 'danger';

@Component({
  selector: 'cog-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      #svg
      [class]="iconClass()"
      [style.--_icon-size.px]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
      [attr.role]="title() ? 'img' : 'presentation'"
      [attr.aria-hidden]="title() ? null : 'true'"
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
        width: var(--_icon-size, 16px);
        height: var(--_icon-size, 16px);
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
  readonly name = input<CognosIconName>('lock');
  readonly size = input<CognosIconSize>(16, { transform: iconSizeAttribute });
  readonly title = input<string | null>(null);
  readonly tone = input<CognosIconTone>('current');

  private readonly svgRef = viewChild.required<ElementRef<SVGSVGElement>>('svg');

  protected readonly iconClass = computed(
    () => `cog-icon cog-icon--size-${this.size()} cog-icon--tone-${this.tone()}`,
  );

  constructor() {
    afterRenderEffect(() => {
      renderIcon(this.svgRef().nativeElement, getCognosIcon(this.name()), this.title());
    });
  }
}

type IconElement = CognosIconNode[number];

function iconSizeAttribute(value: unknown): CognosIconSize {
  const parsed = Number(value);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed);
  }

  return 16;
}

const svgNamespace = 'http://www.w3.org/2000/svg';

function renderIcon(
  svg: SVGSVGElement,
  icon: CognosIconNode,
  title: string | null,
): void {
  svg.replaceChildren();

  if (title) {
    const titleElement = svg.ownerDocument.createElementNS(svgNamespace, 'title');
    titleElement.textContent = title;
    svg.append(titleElement);
  }

  for (const [tag, attrs] of icon) {
    svg.append(renderIconElement(svg, [tag, attrs]));
  }
}

function renderIconElement(svg: SVGSVGElement, [tag, attrs]: IconElement): SVGElement {
  const element = svg.ownerDocument.createElementNS(svgNamespace, tag);

  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined) {
      continue;
    }

    element.setAttribute(name, String(value));
  }

  return element;
}
