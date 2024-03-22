import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { EMPTY, map, switchMap } from 'rxjs';

import { ConversationService } from '@app/services/conversation.service';
import { VaultService } from '@app/services/vault.service';

import { MessageFormComponent } from '../message-form/message-form.component';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [MessageFormComponent, MessageListComponent],
  templateUrl: './conversation-detail.component.html',
  styleUrl: './conversation-detail.component.scss',
})
export class ConversationDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly vaultService = inject(VaultService);
  private readonly conversationService = inject(ConversationService);

  constructor() {
    this.vaultService.keyPair$
      .pipe(
        switchMap((keyPair) => {
          if (!keyPair) {
            return EMPTY;
          }
          return this.route.paramMap.pipe(
            map((params) => {
              const conversationId = params.get('conversationId');
              if (!conversationId) {
                return;
              }
              this.conversationService.selectConversation$.next(conversationId);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }
}
