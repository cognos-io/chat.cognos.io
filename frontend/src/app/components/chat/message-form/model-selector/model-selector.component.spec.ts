import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Model } from '@app/interfaces/model';
import { BillingService } from '@app/services/billing.service';
import { ModelService } from '@app/services/model.service';
import { ProjectService } from '@app/services/project.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { modelSupportsCapability } from '@app/utils/model-discovery';

import { ModelSelectorComponent } from './model-selector.component';

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'm',
    name: 'M',
    slug: 'm',
    providerId: 'requesty',
    description: '',
    privacyTier: 'eu',
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 1000,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    supportsImageGeneration: false,
    supportsVision: false,
    supportsFileInput: false,
    supportsToolCalling: false,
    supportsWebSearch: false,
    supportsComputerUse: false,
    eligibleForCompaction: false,
    supportsStructuredOutput: false,
    supportsCacheHints: false,
    approxCharsPerToken: 0,
    reasoningEfforts: [],
    isEligible: true,
    ...overrides,
  };
}

describe('modelSupportsCapability', () => {
  const textModel = makeModel({ id: 'text', supportsImageGeneration: false });
  const imageModel = makeModel({ id: 'image', supportsImageGeneration: true });

  it('passes every model when no capability is required', () => {
    expect(modelSupportsCapability(textModel, null)).toBe(true);
    expect(modelSupportsCapability(imageModel, null)).toBe(true);
  });

  it('keeps only image-capable models when image generation is required', () => {
    expect(modelSupportsCapability(imageModel, 'image_generation')).toBe(true);
    expect(modelSupportsCapability(textModel, 'image_generation')).toBe(false);
  });
});

describe('ModelSelectorComponent', () => {
  let fixture: ComponentFixture<ModelSelectorComponent>;
  let selectModel: ReturnType<typeof vi.fn>;
  let hiddenModels: ReturnType<typeof signal<string[]>>;
  let selectedProject: ReturnType<
    typeof signal<{ decryptedData: { defaultModelId: string } } | null>
  >;

  // 'gemini-3-5-flash' is a curated recommended id; the others are plain.
  const recommended = makeModel({ id: 'gemini-3-5-flash', name: 'Gemini Flash' });
  const plain = makeModel({ id: 'plain-model', name: 'Plain Model' });
  const hidden = makeModel({ id: 'hidden-model', name: 'Hidden Model' });

  function rowNames(): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.model-selector__name'),
    ).map((el) => (el as HTMLElement).textContent?.trim() ?? '');
  }

  beforeEach(async () => {
    selectModel = vi.fn();
    hiddenModels = signal<string[]>(['hidden-model']);
    selectedProject = signal<{ decryptedData: { defaultModelId: string } } | null>(
      null,
    );

    await TestBed.configureTestingModule({
      imports: [ModelSelectorComponent],
      providers: [
        provideRouter([]),
        {
          provide: ModelService,
          useValue: {
            modelList: signal([recommended, plain, hidden]),
            selectedModel: signal(recommended),
            selectModel,
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            pinnedModels: signal<string[]>([]),
            recentModels: signal<string[]>([]),
            hiddenModels,
            isModelPinned: () => false,
            pinModel: vi.fn(),
            unpinModel: vi.fn(),
          },
        },
        {
          provide: BillingService,
          useValue: { isUnlimited: signal(false) },
        },
        {
          provide: ProjectService,
          useValue: { selectedProject },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModelSelectorComponent);
    fixture.detectChanges();
  });

  it('defaults to the Recommended filter and shows only recommended models', () => {
    expect(rowNames()).toEqual(['Gemini Flash']);
  });

  it('shows all eligible models when the Recommended chip is toggled off', () => {
    const recommendedChip = fixture.nativeElement.querySelector(
      '.model-selector__chip',
    ) as HTMLButtonElement;
    recommendedChip.click();
    fixture.detectChanges();

    // Hidden model stays excluded; the rest appear.
    expect(rowNames()).toContain('Gemini Flash');
    expect(rowNames()).toContain('Plain Model');
    expect(rowNames()).not.toContain('Hidden Model');
  });

  it('narrows by search and overrides the default Recommended chip', () => {
    const input = fixture.nativeElement.querySelector(
      '.model-selector__search-input',
    ) as HTMLInputElement;
    input.value = 'plain';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(rowNames()).toEqual(['Plain Model']);
  });

  it('selects a model and emits modelSelected', () => {
    const selected = vi.fn();
    fixture.componentInstance.modelSelected.subscribe(selected);

    // Clear the recommended filter so the plain row is visible, then click it.
    (
      fixture.nativeElement.querySelector('.model-selector__chip') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('.model-selector__row'),
    ) as HTMLButtonElement[];
    const plainRow = rows.find((r) => r.textContent?.includes('Plain Model'))!;
    plainRow.click();

    expect(selectModel).toHaveBeenCalledWith('plain-model');
    expect(selected).toHaveBeenCalled();
  });

  it('never shows hidden models in the normal list', () => {
    (
      fixture.nativeElement.querySelector('.model-selector__chip') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(rowNames()).not.toContain('Hidden Model');
  });

  it('emits closed on Escape', () => {
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);

    const root = fixture.nativeElement.querySelector('.model-selector') as HTMLElement;
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(closed).toHaveBeenCalled();
  });

  it('shows a notice when the active project default is unavailable', () => {
    // No notice when there is no project / no project default.
    expect(fixture.nativeElement.querySelector('.model-selector__notice')).toBeNull();

    // A project default that isn't in the eligible catalogue surfaces the note.
    selectedProject.set({ decryptedData: { defaultModelId: 'gone-from-catalogue' } });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('.model-selector__notice'),
    ).not.toBeNull();

    // An available project default shows no notice.
    selectedProject.set({ decryptedData: { defaultModelId: 'plain-model' } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.model-selector__notice')).toBeNull();
  });
});
