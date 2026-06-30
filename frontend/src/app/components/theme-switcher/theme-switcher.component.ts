import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosChoiceChipGroupComponent } from '@cognos/ui-angular';

import { ThemeService } from '@app/services/theme.service';
import { ThemePreference, isThemePreference } from '@app/theme/theme';

// ThemeSwitcherComponent (`app-theme-switcher`) is the Appearance control on the
// account page: a single-select Light/Dark/System pill group. Selecting a chip
// applies immediately (no Save button). When System is selected it shows which
// resolved mode is currently active so the choice isn't a mystery.
@Component({
  selector: 'app-theme-switcher',
  standalone: true,
  imports: [CognosChoiceChipGroupComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="theme-switcher" *transloco="let t">
      <cog-choice-chip-group
        [options]="[
          { value: 'system', label: t('account.appearance.system') },
          { value: 'light', label: t('account.appearance.light') },
          { value: 'dark', label: t('account.appearance.dark') },
        ]"
        [value]="preference()"
        [ariaLabel]="t('account.appearance.label')"
        (valueChange)="select($event)"
      />

      @if (preference() === 'system') {
        <p class="theme-switcher__hint" role="status">
          {{
            resolvedTheme() === 'dark'
              ? t('account.appearance.systemHintDark')
              : t('account.appearance.systemHintLight')
          }}
        </p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    /* Sits in the card's bottom-right actions row, so align the chips and the
       hint to the trailing edge like the other cards' controls. */
    .theme-switcher {
      display: grid;
      gap: var(--cog-space-075);
      justify-items: end;
    }

    .theme-switcher__hint {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
      text-align: right;
    }
  `,
})
export class ThemeSwitcherComponent {
  private readonly _theme = inject(ThemeService);

  readonly preference = this._theme.preference;
  readonly resolvedTheme = this._theme.resolvedTheme;

  protected select(value: string | null): void {
    if (isThemePreference(value)) {
      this._theme.use(value as ThemePreference);
    }
  }
}
