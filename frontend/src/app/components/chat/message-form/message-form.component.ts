import { isPlatformBrowser } from '@angular/common';
import { Component, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { ReplaySubject } from 'rxjs';

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
    MatDialogModule,
  ],
  templateUrl: './message-form.component.html',
  styleUrl: './message-form.component.scss',
})
export class MessageFormComponent implements OnDestroy {
  private _fb = inject(FormBuilder);
  private _dialog = inject(MatDialog);
  private _platformId = inject(PLATFORM_ID);
  private _destroyed$: ReplaySubject<boolean> = new ReplaySubject(1);

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

  ngOnDestroy(): void {
    this._destroyed$.next(true);
    this._destroyed$.complete();
  }

  openAgentSelector() {
    this._dialog.open(AgentSelectorComponent);
  }

  openModelSelector() {
    this._dialog.open(ModelSelectorComponent, {});
  }

  sendMessage() {
    this.messageService.sendMessage$.next(this.messageForm.value);
    this.messageForm.reset();
  }
}
