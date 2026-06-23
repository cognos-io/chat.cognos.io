import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NEVER, of } from 'rxjs';

import { Model, PrivacyTier } from '@app/interfaces/model';
import { AuthService } from '@app/services/auth.service';
import { ModelService } from '@app/services/model.service';

import { DataProcessingComponent } from './data-processing.component';

function model(id: string, privacyTier: PrivacyTier): Model {
  return {
    id,
    name: id,
    slug: id,
    providerId: 'infomaniak',
    description: '',
    privacyTier,
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 1000,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    supportsImageGeneration: false,
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

  beforeEach(async () => {
    modelList = signal<Model[]>([]);
    privacyTier = signal<PrivacyTier>('eu');
    setPrivacyTier = vi.fn().mockReturnValue(of({}));

    await TestBed.configureTestingModule({
      imports: [DataProcessingComponent],
      providers: [
        { provide: ModelService, useValue: { modelList, privacyTier } },
        { provide: AuthService, useValue: { setPrivacyTier } },
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
});
