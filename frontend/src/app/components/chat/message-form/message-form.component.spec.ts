import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Subject } from 'rxjs';

import { AttachmentLibraryService } from '@app/attachments/attachment-library.service';
import { AttachmentProcessingService } from '@app/attachments/attachment-processing.service';
import { Message } from '@app/interfaces/message';
import { AuthService } from '@app/services/auth.service';
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
  const selectedModelTextIncompatible = signal(false);
  const composerTools = {
    imageGenerationEnabled,
    selectedModelUnsupported,
    selectedModelTextIncompatible,
    requiredCapability: computed(() =>
      imageGenerationEnabled() ? 'image_generation' : 'text_completion',
    ),
    suggestedImageModel: signal(null),
    autoSwitchNotice: signal(null),
    toggleImageGeneration: () => imageGenerationEnabled.update((v) => !v),
    setImageGeneration: (value: boolean) => imageGenerationEnabled.set(value),
    useSuggestedImageModel: vi.fn(),
    dismissAutoSwitch: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(async () => {
    status.set(MessageStatus.None);
    messages.set([]);
    imageGenerationEnabled.set(false);
    selectedModelUnsupported.set(false);
    selectedModelTextIncompatible.set(false);
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
        {
          provide: AuthService,
          useValue: {
            needsEmailVerification: signal(false),
            email: signal('user@example.com'),
            requestVerification: vi.fn(),
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
      redactionCandidatesContent: '',
      redactionCandidates: [],
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

  it('blocks send and opens the confirm when a detected value is left un-redacted', () => {
    const candidate = {
      type: 'email' as const,
      detector: 'email:v1',
      start: 0,
      end: 15,
      value: 'me@example.com',
      normalized: 'me@example.com',
      confidence: 'high' as const,
    };
    // The stubbed detector now finds our candidate for any draft.
    const redaction = TestBed.inject(RedactionService) as unknown as {
      detect: (text: string) => (typeof candidate)[];
    };
    redaction.detect = () => [candidate];

    component.messageForm.controls.content.setValue('email me@example.com');
    // Opt OUT of redacting the detection — this is what makes the send risky.
    component.toggleRedaction(candidate);

    component.sendMessage();

    // The message is held back and the blocking confirm is shown instead.
    expect(component.redactionWarningOpen()).toBe(true);
    expect(component.pendingUnredactedCount()).toBe(1);
    expect(messageService.sendMessage$.next).not.toHaveBeenCalled();

    // "Send anyway" dispatches the draft as-is (opt-out preserved).
    component.sendAnyway();
    expect(component.redactionWarningOpen()).toBe(false);
    expect(messageService.sendMessage$.next).toHaveBeenCalledTimes(1);
    const sentAnyway = vi.mocked(messageService.sendMessage$.next).mock.calls[0][0];
    expect(sentAnyway.content).toBe('email me@example.com');
    // The opt-out is preserved (one deselected key), so the value is NOT
    // redacted on send.
    expect(sentAnyway.redactionDeselected).toHaveLength(1);
  });

  it('"Redact & send" clears the opt-outs so every detected value is redacted', () => {
    const candidate = {
      type: 'email' as const,
      detector: 'email:v1',
      start: 0,
      end: 15,
      value: 'me@example.com',
      normalized: 'me@example.com',
      confidence: 'high' as const,
    };
    const redaction = TestBed.inject(RedactionService) as unknown as {
      detect: (text: string) => (typeof candidate)[];
    };
    redaction.detect = () => [candidate];

    component.messageForm.controls.content.setValue('email me@example.com');
    component.toggleRedaction(candidate);
    component.sendMessage();
    expect(component.redactionWarningOpen()).toBe(true);

    component.redactAndSend();

    expect(component.redactionWarningOpen()).toBe(false);
    expect(messageService.sendMessage$.next).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(messageService.sendMessage$.next).mock.calls[0][0];
    // No opt-outs remain, so the detection is redacted before sending.
    expect(sent.redactionDeselected).toEqual([]);
  });

  it('does not warn when every detected value will be redacted (the default)', () => {
    const candidate = {
      type: 'email' as const,
      detector: 'email:v1',
      start: 0,
      end: 15,
      value: 'me@example.com',
      normalized: 'me@example.com',
      confidence: 'high' as const,
    };
    const redaction = TestBed.inject(RedactionService) as unknown as {
      detect: (text: string) => (typeof candidate)[];
    };
    redaction.detect = () => [candidate];

    // Detection present, but nothing deselected → it will be redacted → no prompt.
    component.messageForm.controls.content.setValue('email me@example.com');
    component.sendMessage();

    expect(component.redactionWarningOpen()).toBe(false);
    expect(messageService.sendMessage$.next).toHaveBeenCalledTimes(1);
  });

  it('combines repeated detected values in the preview controls', () => {
    component.redactionCandidates.set([
      {
        type: 'person',
        detector: 'nlp:person',
        start: 11,
        end: 15,
        value: 'Lily',
        normalized: 'lily',
        confidence: 'medium',
      },
      {
        type: 'person',
        detector: 'nlp:person',
        start: 32,
        end: 36,
        value: 'Lily',
        normalized: 'lily',
        confidence: 'medium',
      },
      {
        type: 'person',
        detector: 'nlp:person',
        start: 47,
        end: 51,
        value: 'Lara',
        normalized: 'lara',
        confidence: 'medium',
      },
    ]);

    const mediumGroup = component
      .redactionPreviewGroups()
      .find((group) => group.severity === 'medium');

    expect(component.redactionActiveCount()).toBe(2);
    expect(mediumGroup?.items.map((item) => item.value)).toEqual(['Lily', 'Lara']);
  });

  it('highlights redaction candidates already shown in the preview', () => {
    const content = 'My name is John Doe';
    component.messageForm.controls.content.setValue(content);
    component.redactionCandidates.set([
      {
        type: 'person',
        detector: 'nlp:person',
        start: 11,
        end: 19,
        value: 'John Doe',
        normalized: 'john doe',
        confidence: 'medium',
      },
    ]);
    (
      component as unknown as {
        _redactionCandidatesContent: { set(value: string): void };
      }
    )._redactionCandidatesContent.set(content);

    component.highlightRedactions.set(true);

    expect(component.redactionHighlightHtml()).toContain('<mark>John Doe</mark>');
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
