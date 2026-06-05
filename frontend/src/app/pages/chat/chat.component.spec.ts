import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Dialog } from '@angular/cdk/dialog';
import { provideRouter, Router } from '@angular/router';

import { Subject } from 'rxjs';


import { ChatComponent } from './chat.component';
import { ConversationService } from '../../services/conversation.service';
import { DeviceService } from '../../services/device.service';
import { MessageService } from '../../services/message.service';
import { VaultService } from '../../services/vault.service';

describe('ChatComponent', () => {
  let fixture: ComponentFixture<ChatComponent>;
  let component: ChatComponent;
  let router: Router;

  const temporaryConversation = signal(false);
  const selectedConversation = signal<{ decryptedData: { title: string } } | undefined>(
    undefined,
  );
  const pinnedConversations = signal<any[]>([]);
  const recentConversations = signal<any[]>([]);
  const messages = signal<any[]>([]);

  const conversationService = {
    conversation: selectedConversation,
    filter$: { next: vi.fn() },
    hasPinnedConversations: () => pinnedConversations().length > 0,
    pinnedConversations,
    hasNonPinnedConversations: () => recentConversations().length > 0,
    nonPinnedConversations: recentConversations,
    isTemporaryConversation: temporaryConversation,
  };

  const messageService = {
    messages,
    resetState: vi.fn(),
  };

  beforeEach(async () => {
    temporaryConversation.set(false);
    selectedConversation.set(undefined);
    pinnedConversations.set([]);
    recentConversations.set([]);
    messages.set([]);
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ChatComponent],
      providers: [
        provideRouter([]),
        { provide: ConversationService, useValue: conversationService },
        { provide: DeviceService, useValue: { isMobile: signal(false) } },
        { provide: MessageService, useValue: messageService },
        { provide: Dialog, useValue: { open: vi.fn() } },
        { provide: VaultService, useValue: { keyPair$: new Subject() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.detectChanges();
  });

  it('clears temporary messages and navigates to root for a new chat', () => {
    temporaryConversation.set(true);
    messages.set([{ id: '1' }]);
    Object.defineProperty(router, 'url', { value: '/c/123', configurable: true });

    component.onNewConversation();

    expect(messageService.resetState).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('does not navigate when already on the new chat route', () => {
    Object.defineProperty(router, 'url', { value: '/', configurable: true });

    component.onNewConversation();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('forwards search changes to the conversation filter', () => {
    component.onSearchChange('policy');

    expect(conversationService.filter$.next).toHaveBeenCalledWith('policy');
  });
});
