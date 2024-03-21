import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';

import { Message } from '@app/interfaces/message';
import { MessageService } from '@app/services/message.service';

export const messageResolver: ResolveFn<Message[]> = () => {
  const messageService = inject(MessageService);

  return messageService.messages();
};
