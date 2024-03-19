import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { AgentService } from '@app/services/agent.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';

import { AgentSelectorComponent } from './agent-selector/agent-selector.component';
import { ModelSelectorComponent } from './model-selector/model-selector.component';

@Component({
  selector: 'app-message-form',
  standalone: true,
  imports: [
    MatButtonModule,
    ReactiveFormsModule,
    MatInputModule,
    MatIconModule,
    MatBottomSheetModule,
  ],
  templateUrl: './message-form.component.html',
  styleUrl: './message-form.component.scss',
})
export class MessageFormComponent {
  private _fb = inject(FormBuilder);
  private _bottomSheet = inject(MatBottomSheet);
  private _platformId = inject(PLATFORM_ID);

  isMac = false;
  public readonly messageService = inject(MessageService);
  public readonly agentService = inject(AgentService);
  public readonly modelService = inject(ModelService);

  messageForm = this._fb.group({
    message: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  constructor() {
    if (isPlatformBrowser(this._platformId)) {
      this.isMac = window.navigator.userAgent.includes('Mac');
    }
  }

  openAgentSelector() {
    this._bottomSheet.open(AgentSelectorComponent);
  }

  openModelSelector() {
    this._bottomSheet.open(ModelSelectorComponent);
  }

  sendMessage() {
    this.messageService.sendMessage$.next(this.messageForm.value);
    this.messageForm.reset();
  }

  onKeydown(event: KeyboardEvent) {
    if (this.isMac) {
      if (event.metaKey && event.key === 'Enter') {
        this.sendMessage();
      }
    } else if (event.ctrlKey && event.key === 'Enter') {
      this.sendMessage();
    }
  }
}
