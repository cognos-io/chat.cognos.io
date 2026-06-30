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

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosSearchFieldComponent,
} from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { PersonaEditorComponent } from '@app/components/personas/persona-editor/persona-editor.component';
import { Persona } from '@app/interfaces/persona';
import { DeviceService } from '@app/services/device.service';
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
    CognosLozengeComponent,
    CognosSearchFieldComponent,
    PersonaAvatarComponent,
    PersonaEditorComponent,
    TranslocoModule,
  ],
  templateUrl: './personas-page.component.html',
  styleUrl: './personas-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonasPageComponent {
  private readonly _personas = inject(PersonaService);
  private readonly _location = inject(Location);
  private readonly _device = inject(DeviceService);
  private readonly _transloco = inject(TranslocoService);

  protected readonly isMobile = computed(() => this._device.isMobile());

  protected readonly query = signal('');
  protected readonly viewMode = signal<ViewMode>('grid');
  protected readonly editing = signal<EditorTarget | null>(null);

  protected readonly selectedId = computed(() => this._personas.selectedPersona().id);

  // Pinning moves a persona into its own section; recency does not. A
  // recently-used persona still belongs to Official or My personas, so only
  // pinned ids are removed from the home sections.
  private readonly _pinnedIds = computed(
    () => new Set(this._personas.pinnedPersonas().map((persona) => persona.id)),
  );

  protected readonly sections = computed<PersonaSection[]>(() => {
    const pinned = this._pinnedIds();
    const sections: PersonaSection[] = [
      {
        id: 'pinned',
        label: this._transloco.translate('personas.page.sections.pinned'),
        personas: this._personas.pinnedPersonas(),
      },
      {
        id: 'recent',
        label: this._transloco.translate('personas.page.sections.recent'),
        personas: this._personas.recentPersonas(),
      },
      {
        id: 'official',
        label: this._transloco.translate('personas.page.sections.official'),
        personas: this._personas
          .officialPersonas()
          .filter((persona) => !pinned.has(persona.id)),
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
    const pinned = this._pinnedIds();
    return this.filter(
      this._personas.customPersonas().filter((persona) => !pinned.has(persona.id)),
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

  // Make this persona the default for new chats (persisted to the single user
  // preferences object). Already-default is a no-op.
  protected setDefault(persona: Persona, event: Event): void {
    event.stopPropagation();
    if (!this.isDefault(persona)) {
      this._personas.setDefault(persona.id);
    }
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
