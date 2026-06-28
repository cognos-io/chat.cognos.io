import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Subject } from 'rxjs';

import { AttachmentLibraryService } from '@app/attachments/attachment-library.service';
import { AttachmentProcessingService } from '@app/attachments/attachment-processing.service';
import { Message } from '@app/interfaces/message';
import { BillingService } from '@app/services/billing.service';
import { ComposerToolsService } from '@app/services/composer-tools.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { MessageService, MessageStatus } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { RedactionService } from '@app/services/redaction.service';
import { VaultService } from '@app/services/vault.service';

import { MessageFormComponent } from './message-form.component';

describe('MessageFormComponent', () => {
  let fixture: ComponentFixture<MessageFormComponent>;
  let component: MessageFormComponent;

  const status = signal(MessageStatus.None);
  const messages = signal<Message[]>([]);

  const selectedModel = signal<{
    id: string;
    name: string;
    isEligible: boolean;
    supportsImageGeneration?: boolean;
    reasoningEfforts: string[];
  }>({
    id: 'model-1',
    name: 'Claude Sonnet',
    isEligible: true,
    reasoningEfforts: [],
  });
  const selectedReasoningEffort = signal('');

  const messageService = {
    status,
    messages,
    sendMessage$: { next: vi.fn() },
    stopActiveCompletion: vi.fn(),
    resetState: vi.fn(),
  };

  // Mirror ComposerToolsService's surface so the composer can read tool state
  // without pulling in the real service (and its ModelService dependency).
  const imageGenerationEnabled = signal(false);
  const selectedModelUnsupported = signal(false);
  const composerTools = {
    imageGenerationEnabled,
    selectedModelUnsupported,
    requiredCapability: computed(() =>
      imageGenerationEnabled() ? 'image_generation' : null,
    ),
    suggestedImageModel: signal(null),
    toggleImageGeneration: () => imageGenerationEnabled.update((v) => !v),
    setImageGeneration: (value: boolean) => imageGenerationEnabled.set(value),
    useSuggestedImageModel: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(async () => {
    status.set(MessageStatus.None);
    messages.set([]);
    imageGenerationEnabled.set(false);
    selectedModelUnsupported.set(false);
    selectedModel.set({
      id: 'model-1',
      name: 'Claude Sonnet',
      isEligible: true,
      reasoningEfforts: [],
    });
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000000',
    );

    await TestBed.configureTestingModule({
      imports: [MessageFormComponent],
      providers: [
        provideRouter([]),
        {
          provide: PersonaService,
          useValue: {
            selectedPersona: signal({
              id: 'persona-1',
              name: 'Cognos Persona',
              systemPrompt: 'Be helpful.',
              icon: 'sparkles',
              color: 'green',
            }),
            pinnedPersonas: signal([]),
            recentPersonas: signal([]),
            officialPersonas: signal([]),
            selectPersona: vi.fn(),
          },
        },
        {
          provide: ConversationService,
          useValue: {
            isTemporaryConversation: signal(false),
            conversation: () => null,
          },
        },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        // The composer's redaction preview reads these; stub them so the real
        // RedactionService (and its API/conversation deps) isn't built.
        {
          provide: RedactionService,
          useValue: {
            detect: () => [],
            enabled: () => true,
            revision: () => 0,
            customRedactionValues: () => [],
          },
        },
        { provide: MessageService, useValue: messageService },
        {
          provide: ModelService,
          useValue: { selectedModel, selectedReasoningEffort },
        },
        { provide: ComposerToolsService, useValue: composerTools },
        {
          provide: AttachmentProcessingService,
          useValue: {
            attachments: signal([]),
            hasPending: signal(false),
            count: signal(0),
            canAddMore: signal(true),
            add: vi.fn(),
            remove: vi.fn(),
            clear: vi.fn(),
            completionInputs: () => ({
              attachmentIds: [],
              attachmentContexts: [],
              redactionEntries: [],
            }),
          },
        },
        // The composer injects AttachmentLibraryService for the "from library"
        // flow; stub it so its real PocketBase-backed dependency chain
        // (AttachmentUploadService -> Client) isn't constructed in unit tests.
        {
          provide: AttachmentLibraryService,
          useValue: {
            files: signal([]),
            loaded: signal(false),
            materialize: vi.fn(),
            splitNewVsExisting: vi.fn(() =>
              Promise.resolve({ toUpload: [], existing: [] }),
            ),
          },
        },
        { provide: VaultService, useValue: { keyPair$: new Subject() } },
        {
          provide: BillingService,
          useValue: {
            isSendingLocked: signal(false),
            refresh: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MessageFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a message request and clears the form', () => {
    component.messageForm.controls.content.setValue('Hello world');

    component.sendMessage();

    expect(messageService.sendMessage$.next).toHaveBeenCalledWith({
      content: 'Hello world',
      requestId: '00000000-0000-4000-8000-000000000000',
      // No detections deselected and no manual selections (the stub detects
      // nothing), so both lists are empty.
      redactionDeselected: [],
      redactionCustom: [],
      // Image generation is off by default.
      imageGeneration: false,
    });
    expect(component.messageForm.controls.content.value).toBe('');
  });

  it('restores the previous message after a send error', () => {
    component.messageForm.controls.content.setValue('Retry me');
    component.sendMessage();

    status.set(MessageStatus.Sending);
    fixture.detectChanges();
    expect(component.messageForm.disabled).toBe(false);
    expect(
      (fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement).readOnly,
    ).toBe(true);

    status.set(MessageStatus.ErrorSending);
    fixture.detectChanges();

    expect(component.messageForm.disabled).toBe(false);
    expect(component.messageForm.controls.content.value).toBe('Retry me');
  });

  it('shows a stop action while a completion is streaming', () => {
    status.set(MessageStatus.Sending);
    fixture.detectChanges();

    const stopButton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Stop')) as HTMLButtonElement;

    expect(stopButton).toBeTruthy();

    stopButton.click();

    expect(messageService.stopActiveCompletion).toHaveBeenCalledTimes(1);
    expect(messageService.sendMessage$.next).not.toHaveBeenCalled();
  });

  it('stops streaming on Escape from inside the composer only while streaming', () => {
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;

    form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(messageService.stopActiveCompletion).not.toHaveBeenCalled();

    status.set(MessageStatus.Sending);
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(event);

    expect(messageService.stopActiveCompletion).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not send when the selected model is unavailable', () => {
    selectedModel.set({
      id: 'model-2',
      name: 'Global Model',
      isEligible: false,
      reasoningEfforts: [],
    });
    component.messageForm.controls.content.setValue('Blocked message');
    fixture.detectChanges();

    component.sendMessage();

    expect(component.canSendMessage()).toBe(false);
    expect(messageService.sendMessage$.next).not.toHaveBeenCalled();
    expect(component.messageForm.controls.content.value).toBe('Blocked message');
  });

  it('defaults the image generation tool to off', () => {
    expect(component.composerTools.imageGenerationEnabled()).toBe(false);
    expect(component.anyToolActive()).toBe(false);
  });

  it('blocks send when a tool is on for an unsupported model', () => {
    composerTools.setImageGeneration(true);
    selectedModelUnsupported.set(true);
    component.messageForm.controls.content.setValue('a fox');
    fixture.detectChanges();

    expect(component.anyToolActive()).toBe(true);
    expect(component.canSendMessage()).toBe(false);

    component.sendMessage();
    expect(messageService.sendMessage$.next).not.toHaveBeenCalled();
  });

  it('sends an image request when the tool is on for a capable model', () => {
    composerTools.setImageGeneration(true);
    selectedModelUnsupported.set(false);
    component.messageForm.controls.content.setValue('a watercolour fox');
    fixture.detectChanges();

    expect(component.canSendMessage()).toBe(true);

    component.sendMessage();

    expect(messageService.sendMessage$.next).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'a watercolour fox',
        imageGeneration: true,
      }),
    );
  });
});
