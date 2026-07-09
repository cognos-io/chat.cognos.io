import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosIconComponent } from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { Persona } from '@app/interfaces/persona';
import { PersonaService } from '@app/services/persona.service';

// The in-chat persona switcher dropdown: a short quick-switch list (active +
// recent + pinned) and a "Manage personas" link to the full page. Designed to
// drop into a cdkConnectedOverlay from the composer, like the model selector.
@Component({
  selector: 'app-persona-switcher',
  standalone: true,
  imports: [CognosIconComponent, PersonaAvatarComponent, TranslocoModule],
  template: `
    <div
      class="persona-switcher"
      role="listbox"
      [attr.aria-label]="t('chat.personas.switchAria')"
      *transloco="let t"
    >
      <ul class="persona-switcher__list">
        @for (persona of quickList(); track persona.id) {
          <li>
            <button
              type="button"
              role="option"
              class="persona-switcher__row"
              [class.persona-switcher__row--active]="persona.id === selectedId()"
              [attr.aria-selected]="persona.id === selectedId()"
              (click)="select(persona)"
            >
              <app-persona-avatar
                [icon]="persona.icon"
                [color]="persona.color"
                [size]="28"
              />
              <span class="persona-switcher__body">
                <span class="persona-switcher__name">{{ persona.name }}</span>
                <span class="persona-switcher__description">{{
                  persona.description
                }}</span>
              </span>
              @if (persona.id === selectedId()) {
                <cog-icon name="check" [size]="16" tone="success" />
              }
            </button>
          </li>
        }
      </ul>

      <button type="button" class="persona-switcher__manage" (click)="manage()">
        <cog-icon name="settings" [size]="16" />
        {{ t('chat.personas.manage') }}
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .persona-switcher {
      width: min(320px, calc(100vw - var(--cog-space-200)));
      max-height: min(440px, calc(100vh - 160px));
      overflow-y: auto;
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-raised);
      box-shadow: var(--cog-shadow-overlay);
      padding: var(--cog-space-075);
    }

    .persona-switcher__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--cog-space-025);
    }

    .persona-switcher__row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--cog-space-100);
      width: 100%;
      border: 0;
      background: transparent;
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-075) var(--cog-space-100);
      text-align: left;
      cursor: pointer;
      color: var(--cog-text);
      font: inherit;
      transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .persona-switcher__row:hover,
    .persona-switcher__row:focus-visible {
      background: var(--cog-surface-hover);
      outline: 0;
    }

    .persona-switcher__row--active {
      background: var(--cog-selected-bg);
    }

    .persona-switcher__body {
      display: grid;
      gap: var(--cog-border-width);
      min-width: 0;
    }

    .persona-switcher__name {
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
    }

    .persona-switcher__description {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .persona-switcher__manage {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      width: 100%;
      margin-top: var(--cog-space-050);
      padding: var(--cog-space-100);
      border: 0;
      border-top: var(--cog-border-width) solid var(--cog-border);
      border-radius: 0 0 var(--cog-radius-sm) var(--cog-radius-sm);
      background: transparent;
      color: var(--cog-text);
      font: inherit;
      cursor: pointer;
    }

    .persona-switcher__manage:hover,
    .persona-switcher__manage:focus-visible {
      background: var(--cog-surface-hover);
      outline: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaSwitcherComponent {
  private readonly _personas = inject(PersonaService);
  private readonly _router = inject(Router);

  @Output() readonly personaSelected = new EventEmitter<Persona>();
  @Output() readonly managed = new EventEmitter<void>();

  readonly selectedId = computed(() => this._personas.selectedPersona().id);

  // Active first, then recents and pinned, padded with official personas so the
  // list is never empty. De-duplicated and capped to keep the dropdown short.
  readonly quickList = computed<Persona[]>(() => {
    const ordered = [
      this._personas.selectedPersona(),
      ...this._personas.recentPersonas(),
      ...this._personas.pinnedPersonas(),
      ...this._personas.officialPersonas(),
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
    this.personaSelected.emit(persona);
  }

  manage(): void {
    void this._router.navigate(['/personas']);
    this.managed.emit();
  }
}
