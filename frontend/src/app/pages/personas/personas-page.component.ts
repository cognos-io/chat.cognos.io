import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CognosIconComponent } from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { Persona } from '@app/interfaces/persona';
import { PersonaService } from '@app/services/persona.service';

interface PersonaSection {
  id: 'pinned' | 'recent' | 'official';
  label: string;
  personas: Persona[];
}

type ViewMode = 'grid' | 'list';

@Component({
  selector: 'app-personas-page',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    CognosIconComponent,
    PersonaAvatarComponent,
  ],
  templateUrl: './personas-page.component.html',
  styleUrl: './personas-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonasPageComponent {
  private readonly _personas = inject(PersonaService);

  protected readonly query = signal('');
  protected readonly viewMode = signal<ViewMode>('grid');

  protected readonly selectedId = computed(() => this._personas.selectedPersona().id);

  private readonly _usedIds = computed(() => {
    const ids = new Set<string>();
    for (const persona of this._personas.pinnedPersonas()) {
      ids.add(persona.id);
    }
    for (const persona of this._personas.recentPersonas()) {
      ids.add(persona.id);
    }
    return ids;
  });

  protected readonly sections = computed<PersonaSection[]>(() => {
    const used = this._usedIds();
    const sections: PersonaSection[] = [
      { id: 'pinned', label: 'Pinned', personas: this._personas.pinnedPersonas() },
      {
        id: 'recent',
        label: 'Recently used',
        personas: this._personas.recentPersonas(),
      },
      {
        id: 'official',
        label: 'Official',
        personas: this._personas
          .officialPersonas()
          .filter((persona) => !used.has(persona.id)),
      },
    ];

    return sections
      .map((section) => ({
        ...section,
        personas: this.filter(section.personas),
      }))
      .filter((section) => section.personas.length > 0);
  });

  protected readonly myPersonas = computed(() => {
    const used = this._usedIds();
    return this.filter(
      this._personas.customPersonas().filter((persona) => !used.has(persona.id)),
    );
  });

  // The "New persona" card belongs to the My personas section, but it is hidden
  // while searching so a query only ever surfaces matching personas.
  protected readonly showNewPersonaCard = computed(() => this.query().trim() === '');

  protected isActive(persona: Persona): boolean {
    return persona.id === this.selectedId();
  }

  protected isPinned(persona: Persona): boolean {
    return this._personas.isPinned(persona.id);
  }

  protected isDefault(persona: Persona): boolean {
    return this._personas.isDefault(persona.id);
  }

  protected select(persona: Persona): void {
    this._personas.selectPersona(persona.id);
  }

  protected togglePin(persona: Persona, event: Event): void {
    event.stopPropagation();
    this._personas.togglePin(persona.id);
  }

  protected setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
  }

  private filter(personas: Persona[]): Persona[] {
    return this._personas.search(personas, this.query());
  }
}
