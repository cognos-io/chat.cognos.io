import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Model } from '@app/interfaces/model';
import { ComposerToolsService } from '@app/services/composer-tools.service';
import { ModelService } from '@app/services/model.service';

import { ComposerToolsComponent } from './composer-tools.component';

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'm',
    name: 'M',
    displayName: 'M',
    slug: 'm',
    providerId: 'requesty',
    description: '',
    privacyTier: 'eu',
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 1000,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    supportsTextCompletion: true,
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

describe('ComposerToolsComponent', () => {
  let fixture: ComponentFixture<ComposerToolsComponent>;
  let tools: ComposerToolsService;

  const textModel = makeModel({ id: 'text', supportsImageGeneration: false });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComposerToolsComponent],
      providers: [
        ComposerToolsService,
        {
          provide: ModelService,
          useValue: {
            selectedModel: signal(textModel),
            modelList: signal([textModel]),
            selectModel: vi.fn(),
            setActiveCapability: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ComposerToolsComponent);
    tools = TestBed.inject(ComposerToolsService);
    fixture.detectChanges();
  });

  it('associates the label with the switch so clicking the text toggles it', () => {
    const label: HTMLLabelElement = fixture.nativeElement.querySelector(
      'label.composer-tools__copy--clickable',
    );
    const toggleButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.composer-tools__row:not(.composer-tools__row--disabled) cog-toggle button[role="switch"]',
    );

    // The native <label for> must target the switch button's id; this is what
    // makes clicking the title/description toggle the switch in the browser.
    expect(label.getAttribute('for')).toBe('composer-tool-image');
    expect(toggleButton.id).toBe('composer-tool-image');
  });

  it('toggles when the switch is activated', () => {
    const toggleButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '.composer-tools__row:not(.composer-tools__row--disabled) cog-toggle button[role="switch"]',
    );

    toggleButton.click();
    fixture.detectChanges();
    expect(tools.imageGenerationEnabled()).toBe(true);
  });

  // ---- documents (spec docs/specs/document-generation.md §5.2) ------------

  it('renders the Create documents row on by default with no unsupported state', () => {
    const toggleButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button#composer-tool-documents[role="switch"]',
    );

    expect(toggleButton).toBeTruthy();
    expect(toggleButton.getAttribute('aria-checked')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('label[for="composer-tool-documents"]'),
    ).toBeTruthy();
  });

  it('toggles documents off and back on via the switch', () => {
    const toggleButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button#composer-tool-documents[role="switch"]',
    );

    toggleButton.click();
    fixture.detectChanges();
    expect(tools.documentsEnabled()).toBe(false);

    toggleButton.click();
    fixture.detectChanges();
    expect(tools.documentsEnabled()).toBe(true);
  });
});
