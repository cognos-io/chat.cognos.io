import { Component } from '@angular/core';

import { MessageFormComponent } from '../message-form/message-form.component';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [MessageFormComponent, MessageListComponent],
  templateUrl: './conversation-detail.component.html',
  styleUrl: './conversation-detail.component.scss',
})
export class ConversationDetailComponent {}
