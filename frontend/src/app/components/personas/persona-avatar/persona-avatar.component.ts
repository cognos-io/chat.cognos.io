import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { CognosIconComponent } from '@cognos/ui-angular';

import { PersonaColor, PersonaIcon } from '@app/interfaces/persona';

// The persona "identity chip": a rounded square with the persona's icon on a
// pastel background. Reused by the personas page, the editor, the in-chat
// switcher, and the pinned chips so the look stays consistent everywhere.
@Component({
  selector: 'app-persona-avatar',
  standalone: true,
  imports: [CognosIconComponent],
  template: `
    <span
      class="persona-avatar"
      [class]="'persona-avatar--' + color()"
      [style.--persona-avatar-size.px]="size()"
    >
      <cog-icon [name]="icon()" [size]="iconSize()" />
    </span>
  `,
  styles: `
    .persona-avatar {
      --persona-avatar-size: 40;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      inline-size: calc(var(--persona-avatar-size) * 1px);
      block-size: calc(var(--persona-avatar-size) * 1px);
      border-radius: var(--cog-radius-sm, 8px);
      background: var(--persona-avatar-bg, #eef0f3);
      color: var(--persona-avatar-fg, #475569);
    }

    .persona-avatar--green {
      --persona-avatar-bg: #dcfce7;
      --persona-avatar-fg: #15803d;
    }
    .persona-avatar--blue {
      --persona-avatar-bg: #dbeafe;
      --persona-avatar-fg: #1d4ed8;
    }
    .persona-avatar--indigo {
      --persona-avatar-bg: #e0e7ff;
      --persona-avatar-fg: #4338ca;
    }
    .persona-avatar--violet {
      --persona-avatar-bg: #ede9fe;
      --persona-avatar-fg: #6d28d9;
    }
    .persona-avatar--teal {
      --persona-avatar-bg: #ccfbf1;
      --persona-avatar-fg: #0f766e;
    }
    .persona-avatar--sky {
      --persona-avatar-bg: #e0f2fe;
      --persona-avatar-fg: #0369a1;
    }
    .persona-avatar--amber {
      --persona-avatar-bg: #fef3c7;
      --persona-avatar-fg: #b45309;
    }
    .persona-avatar--orange {
      --persona-avatar-bg: #ffedd5;
      --persona-avatar-fg: #c2410c;
    }
    .persona-avatar--pink {
      --persona-avatar-bg: #fce7f3;
      --persona-avatar-fg: #be185d;
    }
    .persona-avatar--slate {
      --persona-avatar-bg: #eef0f3;
      --persona-avatar-fg: #475569;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaAvatarComponent {
  readonly icon = input.required<PersonaIcon>();
  readonly color = input.required<PersonaColor>();
  readonly size = input(40);

  protected readonly iconSize = computed(() => Math.round(this.size() * 0.5));
}
