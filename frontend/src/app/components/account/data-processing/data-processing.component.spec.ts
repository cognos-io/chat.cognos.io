import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NEVER, of } from 'rxjs';

import { Model, PrivacyTier, loadingModel } from '@app/interfaces/model';
import { AuthService } from '@app/services/auth.service';
import { ModelService } from '@app/services/model.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';

import { DataProcessingComponent } from './data-processing.component';

function model(id: string, privacyTier: PrivacyTier): Model {
  return {
    id,
    name: id,
    displayName: id,
    slug: id,
    providerId: 'infomaniak',
    description: '',
    privacyTier,
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
  };
}

describe('DataProcessingComponent', () => {
  let fixture: ComponentFixture<DataProcessingComponent>;
  let component: DataProcessingComponent;
  let modelList: WritableSignal<Model[]>;
  let privacyTier: WritableSignal<PrivacyTier>;
  let setPrivacyTier: ReturnType<typeof vi.fn>;
  let hiddenModels: WritableSignal<string[]>;
  let hideModel: ReturnType<typeof vi.fn>;
  let unhideModel: ReturnType<typeof vi.fn>;
  let resetHiddenModels: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    modelList = signal<Model[]>([]);
    privacyTier = signal<PrivacyTier>('eu');
    setPrivacyTier = vi.fn().mockReturnValue(of({}));
    hiddenModels = signal<string[]>([]);
    hideModel = vi.fn();
    unhideModel = vi.fn();
    resetHiddenModels = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DataProcessingComponent],
      providers: [
        {
          provide: ModelService,
          useValue: { modelList, privacyTier, selectedModel: signal(loadingModel) },
        },
        { provide: AuthService, useValue: { setPrivacyTier } },
        {
          provide: UserPreferencesService,
          useValue: {
            hiddenModels,
            isModelPinned: () => false,
            isModelHidden: (id: string) => hiddenModels().includes(id),
            pinModel: vi.fn(),
            unpinModel: vi.fn(),
            hideModel,
            unhideModel,
            resetHiddenModels,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataProcessingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('counts models cumulatively by residency (ch_only ⊆ eu ⊆ global)', () => {
    modelList.set([
      model('ch-1', 'ch_only'),
      model('ch-2', 'ch_only'),
      model('eu-1', 'eu'),
      model('global-1', 'global'),
    ]);

    expect(component['modelCountForTier']('ch_only')).toBe(2);
    expect(component['modelCountForTier']('eu')).toBe(3);
    expect(component['modelCountForTier']('global')).toBe(4);
  });

  it('counts zero for an empty catalogue (edge)', () => {
    modelList.set([]);
    expect(component['modelCountForTier']('global')).toBe(0);
  });

  it('persists a new tier selection', () => {
    component['selectTier']('global');
    expect(setPrivacyTier).toHaveBeenCalledExactlyOnceWith('global');
  });

  it('does not re-persist the already-selected tier (rainy)', () => {
    // privacyTier() is 'eu'
    component['selectTier']('eu');
    expect(setPrivacyTier).not.toHaveBeenCalled();
  });

  it('ignores a selection while a previous change is still saving', () => {
    // A pending (never-completing) request keeps saving = true.
    setPrivacyTier.mockReturnValue(NEVER);
    component['selectTier']('global');
    expect(setPrivacyTier).toHaveBeenCalledTimes(1);

    component['selectTier']('ch_only');
    expect(setPrivacyTier).toHaveBeenCalledTimes(1); // blocked while saving
  });

  it('narrows the managed list by search', () => {
    modelList.set([
      model('claude-opus', 'eu'),
      model('gemini-flash', 'eu'),
      model('llama', 'eu'),
    ]);

    component['searchQuery'].set('gemini');
    expect(component['orderedModels']().map((m) => m.id)).toEqual(['gemini-flash']);
  });

  it('shows every match when searching, bypassing the collapse limit', () => {
    modelList.set(Array.from({ length: 8 }, (_, i) => model(`model-${i}`, 'eu')));
    // Collapsed by default to the first few rows.
    expect(component['visibleModels']().length).toBe(component['collapsedLimit']);
    // A search shows all matches.
    component['searchQuery'].set('model-');
    expect(component['visibleModels']().length).toBe(8);
  });

  it('hides, unhides and resets hidden models via preferences', () => {
    component['toggleHidden']('m-1');
    expect(hideModel).toHaveBeenCalledExactlyOnceWith('m-1');

    hiddenModels.set(['m-1']);
    component['toggleHidden']('m-1');
    expect(unhideModel).toHaveBeenCalledExactlyOnceWith('m-1');

    component['resetHidden']();
    expect(resetHiddenModels).toHaveBeenCalledOnce();
  });
});
