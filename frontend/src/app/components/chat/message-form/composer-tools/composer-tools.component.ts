import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosToggleComponent,
} from '@cognos/ui-angular';

import { ComposerToolsService } from '@app/services/composer-tools.service';
import { ModelService } from '@app/services/model.service';

// ComposerToolsComponent is the "+ Tools" dropdown panel. It lists the optional
// composer tools as rows with a toggle, and — when an enabled tool can't run on
// the selected model — shows an inline warning with a one-tap switch to a
// suggested compatible model.
@Component({
  selector: 'app-composer-tools',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconComponent,
    CognosToggleComponent,
    TranslocoModule,
  ],
  template: `
    <div class="composer-tools" *transloco="let t">
      <!-- Web search ships later; shown disabled so the menu reads complete. -->
      <div class="composer-tools__row composer-tools__row--disabled">
        <cog-icon name="search" [size]="18" tone="text-subtle" />
        <div class="composer-tools__copy">
          <span class="composer-tools__title">{{
            t('chat.composer.tools.webSearch.title')
          }}</span>
          <span class="composer-tools__desc">{{
            t('chat.composer.tools.webSearch.description')
          }}</span>
        </div>
        <cog-toggle
          [checked]="false"
          [disabled]="true"
          [label]="t('chat.composer.tools.webSearch.title')"
        />
      </div>

      <!-- The copy is a native <label> targeting the switch's id, so clicking
           the title or description toggles it (a <button> is labelable) — no
           extra JS or tab stop, and the cog-toggle stays the keyboard-operable
           role="switch" control. -->
      <div class="composer-tools__row">
        <cog-icon name="image" [size]="18" tone="text-subtle" />
        <label
          class="composer-tools__copy composer-tools__copy--clickable"
          [attr.for]="imageToggleId"
        >
          <span class="composer-tools__title">{{
            t('chat.composer.tools.generateImage.title')
          }}</span>
          <span class="composer-tools__desc">{{
            t('chat.composer.tools.generateImage.description')
          }}</span>
        </label>
        <cog-toggle
          [inputId]="imageToggleId"
          [checked]="tools.imageGenerationEnabled()"
          [label]="t('chat.composer.tools.generateImage.title')"
          (checkedChange)="tools.setImageGeneration($event)"
        />
      </div>

      @if (tools.selectedModelUnsupported()) {
        <div class="composer-tools__warning" role="alert">
          <p class="composer-tools__warning-text">
            <cog-icon name="triangle-alert" [size]="14" />
            {{
              t('chat.composer.tools.unsupported', {
                model: modelService.selectedModel().name,
              })
            }}
          </p>
          @if (tools.suggestedImageModel(); as suggested) {
            <p class="composer-tools__warning-hint">
              {{ t('chat.composer.tools.switchHint') }}
            </p>
            <cog-button
              class="composer-tools__use"
              appearance="subtle"
              icon="cloud"
              type="button"
              (click)="tools.useSuggestedImageModel()"
            >
              {{ t('chat.composer.tools.useModel', { model: suggested.name }) }}
            </cog-button>
          }
        </div>
      }

      @if (tools.selectedModelTextIncompatible()) {
        <div class="composer-tools__warning" role="alert">
          <p class="composer-tools__warning-text">
            <cog-icon name="triangle-alert" [size]="14" />
            {{
              t('chat.composer.tools.imageOnly', {
                model: modelService.selectedModel().name,
              })
            }}
          </p>
          <p class="composer-tools__warning-hint">
            {{ t('chat.composer.tools.imageOnlyHint') }}
          </p>
          <cog-button
            class="composer-tools__use"
            appearance="subtle"
            icon="image"
            type="button"
            (click)="tools.setImageGeneration(true)"
          >
            {{ t('chat.composer.tools.enableImage') }}
          </cog-button>
        </div>
      }
    </div>
  `,
  styles: `
    .composer-tools {
      display: grid;
      gap: var(--cog-space-050);
      width: min(360px, calc(100vw - var(--cog-space-200)));
      padding: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
    }

    .composer-tools__row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: var(--cog-space-100);
      padding: var(--cog-space-100);
      border-radius: var(--cog-radius-sm);
    }

    .composer-tools__row--disabled {
      opacity: 0.55;
    }

    .composer-tools__row:has(.composer-tools__copy--clickable:hover) {
      background: var(--cog-surface-hover);
    }

    .composer-tools__copy {
      display: grid;
      gap: var(--cog-space-025);
    }

    .composer-tools__copy--clickable {
      cursor: pointer;
      user-select: none;
    }

    .composer-tools__title {
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      color: var(--cog-text);
    }

    .composer-tools__desc {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .composer-tools__warning {
      display: grid;
      gap: var(--cog-space-075);
      margin-top: var(--cog-space-050);
      padding: var(--cog-space-100);
      border: 1px solid var(--cog-warning);
      border-radius: var(--cog-radius-sm);
      background: color-mix(in srgb, var(--cog-warning) 12%, transparent);
    }

    .composer-tools__warning-text {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      margin: 0;
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
      color: var(--cog-warning-text);
    }

    .composer-tools__warning-hint {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .composer-tools__use {
      align-self: start;
      box-shadow: inset 0 0 0 1px var(--cog-warning);
      color: var(--cog-warning-text);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComposerToolsComponent {
  readonly tools = inject(ComposerToolsService);
  readonly modelService = inject(ModelService);

  // Ties the Generate image label to its switch so clicking the text toggles it.
  readonly imageToggleId = 'composer-tool-image';
}
