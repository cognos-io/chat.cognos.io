import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';

import { Message } from '@app/interfaces/message';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';

export const messageResolver: ResolveFn<Message[]> = (route) => {
  const conversationService = inject(ConversationService);
  const messageService = inject(MessageService);

  const conversationId = route.paramMap.get('conversationId');
  if (!conversationId) {
    return [];
  }
  conversationService.selectConversation$.next(conversationId);

  return messageService.messages();
};
