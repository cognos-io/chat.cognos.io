import { Location, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CognosButtonComponent, CognosIconComponent } from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { PersonaEditorComponent } from '@app/components/personas/persona-editor/persona-editor.component';
import { Persona } from '@app/interfaces/persona';
import { PersonaInput, PersonaService } from '@app/services/persona.service';

interface PersonaSection {
  id: 'pinned' | 'recent' | 'official';
  label: string;
  personas: Persona[];
}

interface EditorTarget {
  persona: Persona | null;
  seed: PersonaInput | null;
}

type ViewMode = 'grid' | 'list';

@Component({
  selector: 'app-personas-page',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule,
    RouterLink,
    CognosButtonComponent,
    CognosIconComponent,
    PersonaAvatarComponent,
    PersonaEditorComponent,
  ],
  templateUrl: './personas-page.component.html',
  styleUrl: './personas-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonasPageComponent {
  private readonly _personas = inject(PersonaService);
  private readonly _location = inject(Location);

  protected readonly query = signal('');
  protected readonly viewMode = signal<ViewMode>('grid');
  protected readonly editing = signal<EditorTarget | null>(null);

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

  protected openNew(): void {
    this.editing.set({ persona: null, seed: null });
  }

  protected openEditor(persona: Persona, event: Event): void {
    event.stopPropagation();
    this.editing.set({ persona, seed: null });
  }

  protected onDuplicate(seed: PersonaInput): void {
    this.editing.set({ persona: null, seed });
  }

  protected closeEditor(): void {
    this.editing.set(null);
  }

  // Escape closes the editor sheet if it is open, otherwise it leaves the
  // personas page and returns to the conversation the user came from.
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.editing() !== null) {
      this.closeEditor();
      return;
    }
    this._location.back();
  }

  private filter(personas: Persona[]): Persona[] {
    return this._personas.search(personas, this.query());
  }
}
