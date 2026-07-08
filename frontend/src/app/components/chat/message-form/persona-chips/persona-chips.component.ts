import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosIconComponent } from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { Persona } from '@app/interfaces/persona';
import { PersonaService } from '@app/services/persona.service';

// Quick persona chips shown above the composer on a fresh chat: the active
// persona plus pinned ones, and an "All" chip that opens the personas page.
@Component({
  selector: 'app-persona-chips',
  standalone: true,
  imports: [CognosIconComponent, PersonaAvatarComponent, TranslocoModule],
  template: `
    <div
      class="persona-chips"
      role="group"
      [attr.aria-label]="t('chat.personas.quickSwitchAria')"
      *transloco="let t"
    >
      <button
        type="button"
        class="persona-chips__chip persona-chips__chip--all"
        (click)="openAll()"
      >
        <cog-icon name="layout-grid" [size]="14" />
        <span class="persona-chips__name">{{ t('chat.personas.all') }}</span>
      </button>

      @for (persona of chips(); track persona.id) {
        <button
          type="button"
          class="persona-chips__chip"
          [class.is-active]="persona.id === selectedId()"
          [attr.aria-pressed]="persona.id === selectedId()"
          (click)="select(persona)"
        >
          @if (persona.id === selectedId()) {
            <cog-icon name="check" [size]="14" tone="success" />
          } @else {
            <app-persona-avatar
              [icon]="persona.icon"
              [color]="persona.color"
              [size]="18"
            />
          }
          <span class="persona-chips__name">{{ persona.name }}</span>
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .persona-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--cog-space-075);
    }

    .persona-chips__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      padding: var(--cog-space-050) 10px var(--cog-space-050) var(--cog-space-075);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-pill);
      background: var(--cog-surface);
      color: var(--cog-text);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
      transition:
        border-color var(--cog-dur-fast) var(--cog-ease-standard),
        background var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .persona-chips__chip:hover {
      border-color: var(--cog-border-bold);
    }

    .persona-chips__chip.is-active {
      border-color: var(--cog-brand);
      background: var(--cog-success-bg);
      color: var(--cog-success-text);
      font-weight: var(--cog-fw-semibold);
      padding-left: 10px;
    }

    .persona-chips__chip--all {
      border-style: dashed;
      color: var(--cog-text-subtle);
      padding-left: 10px;
    }

    .persona-chips__name {
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaChipsComponent {
  private readonly _personas = inject(PersonaService);
  private readonly _router = inject(Router);

  readonly selectedId = computed(() => this._personas.selectedPersona().id);

  // Active persona first, then pinned and recently-used, de-duplicated and
  // capped so the row stays on one or two lines.
  readonly chips = computed<Persona[]>(() => {
    const ordered = [
      this._personas.selectedPersona(),
      ...this._personas.pinnedPersonas(),
      ...this._personas.recentPersonas(),
    ];
    const seen = new Set<string>();
    const list: Persona[] = [];
    for (const persona of ordered) {
      if (!seen.has(persona.id)) {
        seen.add(persona.id);
        list.push(persona);
      }
    }
    return list.slice(0, 6);
  });

  select(persona: Persona): void {
    this._personas.selectPersona(persona.id);
  }

  openAll(): void {
    void this._router.navigate(['/personas']);
  }
}
