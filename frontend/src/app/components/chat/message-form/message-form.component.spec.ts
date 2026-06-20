import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Subject } from 'rxjs';

import { Message } from '@app/interfaces/message';
import { BillingService } from '@app/services/billing.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { MessageService, MessageStatus } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { VaultService } from '@app/services/vault.service';

import { MessageFormComponent } from './message-form.component';

describe('MessageFormComponent', () => {
  let fixture: ComponentFixture<MessageFormComponent>;
  let component: MessageFormComponent;

  const status = signal(MessageStatus.None);
  const messages = signal<Message[]>([]);

  const selectedModel = signal({
    id: 'model-1',
    name: 'Claude Sonnet',
    isEligible: true,
  });

  const messageService = {
    status,
    messages,
    sendMessage$: { next: vi.fn() },
    stopActiveCompletion: vi.fn(),
    resetState: vi.fn(),
  };

  beforeEach(async () => {
    status.set(MessageStatus.None);
    messages.set([]);
    selectedModel.set({ id: 'model-1', name: 'Claude Sonnet', isEligible: true });
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
          useValue: { isTemporaryConversation: signal(false) },
        },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        { provide: MessageService, useValue: messageService },
        {
          provide: ModelService,
          useValue: { selectedModel },
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
    selectedModel.set({ id: 'model-2', name: 'Global Model', isEligible: false });
    component.messageForm.controls.content.setValue('Blocked message');
    fixture.detectChanges();

    component.sendMessage();

    expect(component.canSendMessage()).toBe(false);
    expect(messageService.sendMessage$.next).not.toHaveBeenCalled();
    expect(component.messageForm.controls.content.value).toBe('Blocked message');
  });
});
