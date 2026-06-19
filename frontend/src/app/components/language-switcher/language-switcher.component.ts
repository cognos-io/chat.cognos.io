import { UpperCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosIconComponent,
  CognosMenuComponent,
  CognosMenuItem,
} from '@cognos/ui-angular';

import { LanguageService } from '@services/language.service';

// A compact globe-style language picker: a trigger showing the active language
// code, opening a `cog-menu` of every supported language in its own words. Used
// on the auth pages (logged-out) and in account settings (logged-in) — the
// LanguageService underneath handles persistence in both cases.
@Component({
  selector: 'app-language-switcher',
  standalone: true,
  imports: [UpperCasePipe, TranslocoModule, CognosIconComponent, CognosMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lang-switcher">
      <button
        type="button"
        class="lang-switcher__trigger"
        [attr.aria-label]="'language.label' | transloco"
        [attr.aria-expanded]="open()"
        aria-haspopup="menu"
        (click)="toggle()"
      >
        <cog-icon name="languages" [size]="18" tone="text-subtle" />
        <span class="lang-switcher__code">{{ current().code | uppercase }}</span>
        <cog-icon name="chevron-down" [size]="14" tone="text-subtle" />
      </button>

      @if (open()) {
        <button
          type="button"
          class="lang-switcher__backdrop"
          aria-hidden="true"
          tabindex="-1"
          (click)="open.set(false)"
        ></button>
        <div class="lang-switcher__panel">
          <cog-menu
            [label]="'language.label' | transloco"
            [items]="items()"
            (itemSelect)="select($event)"
          />
        </div>
      }
    </div>
  `,
  styles: `
    .lang-switcher {
      position: relative;
      display: inline-block;
    }

    .lang-switcher__trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      min-height: 36px;
      padding: 0 var(--cog-space-125);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      color: var(--cog-text);
      font: inherit;
      cursor: pointer;
      transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .lang-switcher__trigger:hover {
      background: var(--cog-surface-hover);
    }

    .lang-switcher__trigger:focus-visible {
      outline: 2px solid var(--cog-brand);
      outline-offset: 2px;
    }

    .lang-switcher__code {
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: 1;
    }

    .lang-switcher__backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
      border: 0;
      background: transparent;
      cursor: default;
    }

    .lang-switcher__panel {
      position: absolute;
      top: calc(100% + var(--cog-space-075));
      right: 0;
      z-index: 50;
    }
  `,
})
export class LanguageSwitcherComponent {
  private readonly _lang = inject(LanguageService);

  readonly open = signal(false);
  readonly current = this._lang.currentLanguage;

  readonly items = computed<CognosMenuItem[]>(() =>
    this._lang.languages.map((language) => ({
      title: language.nativeName,
      sub: language.englishName,
      selected: language.code === this.current().code,
    })),
  );

  toggle(): void {
    this.open.update((value) => !value);
  }

  select(index: number): void {
    const language = this._lang.languages[index];
    if (language) {
      this._lang.use(language.code);
    }
    this.open.set(false);
  }
}
