import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { CognosButtonComponent, CognosIconComponent } from '@cognos/ui-angular';

import {
  Persona,
  PersonaColor,
  PersonaIcon,
  defaultPersonaColor,
  defaultPersonaIcon,
  personaColors,
  personaIcons,
} from '@app/interfaces/persona';
import { PersonaInput, PersonaService } from '@app/services/persona.service';

// Draft a persona being created/edited, or view an official one read-only.
// `persona` is the existing record (custom = editable, official = read-only);
// `seed` pre-fills a brand-new persona (used by "duplicate to edit").
@Component({
  selector: 'app-persona-editor',
  standalone: true,
  imports: [FormsModule, CognosButtonComponent, CognosIconComponent],
  templateUrl: './persona-editor.component.html',
  styleUrl: './persona-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaEditorComponent {
  private readonly _personas = inject(PersonaService);

  readonly persona = input<Persona | null>(null);
  readonly seed = input<PersonaInput | null>(null);

  readonly closed = output<void>();
  readonly saved = output<Persona>();
  readonly duplicated = output<PersonaInput>();

  protected readonly icons = personaIcons;
  protected readonly colors = personaColors;

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly systemPrompt = signal('');
  protected readonly icon = signal<PersonaIcon>(defaultPersonaIcon);
  protected readonly color = signal<PersonaColor>(defaultPersonaColor);
  protected readonly makeDefault = signal(false);
  protected readonly saving = signal(false);

  protected readonly readOnly = computed(() => this.persona()?.source === 'cognos');
  protected readonly isEditing = computed(
    () => this.persona() !== null && this.persona()?.source === 'user',
  );

  protected readonly canSave = computed(
    () =>
      !this.readOnly() &&
      this.name().trim() !== '' &&
      this.description().trim() !== '' &&
      this.systemPrompt().trim() !== '',
  );

  constructor() {
    // Re-seed the form whenever the target persona (or duplicate seed) changes.
    effect(() => {
      const existing = this.persona();
      const source: Persona | PersonaInput | null = existing ?? this.seed();
      this.name.set(source?.name ?? '');
      this.description.set(source?.description ?? '');
      this.systemPrompt.set(source?.systemPrompt ?? '');
      this.icon.set(source?.icon ?? defaultPersonaIcon);
      this.color.set(source?.color ?? defaultPersonaColor);
      // Only an existing persona can already be the default; new/duplicated
      // drafts start unchecked.
      this.makeDefault.set(existing ? this._personas.isDefault(existing.id) : false);
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected selectIcon(icon: PersonaIcon): void {
    this.icon.set(icon);
  }

  protected selectColor(color: PersonaColor): void {
    this.color.set(color);
  }

  protected duplicate(): void {
    const persona = this.persona();
    if (persona) {
      this.duplicated.emit(this._personas.duplicateInput(persona));
    }
  }

  protected remove(): void {
    const persona = this.persona();
    if (!persona || persona.source !== 'user') {
      return;
    }
    this.saving.set(true);
    this._personas.deletePersona(persona).subscribe({
      next: () => {
        this.saving.set(false);
        this.close();
      },
      error: () => this.saving.set(false),
    });
  }

  protected save(): void {
    if (!this.canSave() || this.saving()) {
      return;
    }

    const input: PersonaInput = {
      name: this.name(),
      description: this.description(),
      systemPrompt: this.systemPrompt(),
      icon: this.icon(),
      color: this.color(),
    };

    const existing = this.persona();
    const request$ =
      existing && existing.source === 'user'
        ? this._personas.updatePersona({ ...existing, ...input })
        : this._personas.createPersona(input);

    this.saving.set(true);
    request$.subscribe({
      next: (persona) => {
        if (this.makeDefault()) {
          this._personas.setDefault(persona.id);
        }
        this.saving.set(false);
        this.saved.emit(persona);
        this.close();
      },
      error: () => this.saving.set(false),
    });
  }
}
