import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

import { ReplaySubject, map } from 'rxjs';

import { AgentService } from '@app/services/agent.service';
import { MessageService, MessageStatus } from '@app/services/message.service';
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
  template: `<form
      class="message-form"
      [formGroup]="messageForm"
      (submit)="sendMessage()"
    >
      <mat-form-field class="w-full">
        <mat-label>Chat to an AI</mat-label>
        <textarea
          formControlName="message"
          cdkTextareaAutosize
          name="message-form"
          id="message-form"
          matInput
          placeholder="Teach me about..."
          (keydown.control.enter)="isMac ? undefined : sendMessage()"
          (keydown.meta.enter)="isMac ? sendMessage() : undefined"
        ></textarea>
        @if (messageForm.valid) {
          <button type="submit" matSuffix mat-icon-button="">
            <mat-icon fontSet="bi" fontIcon="bi-send-fill"></mat-icon>
          </button>
        }
      </mat-form-field>
    </form>

    <div class="flex flex-col justify-between md:flex-row md:items-center">
      <span class="hidden italic md:block">
        @if (isMac) {
          Cmd
        } @else {
          Ctrl
        }
        + Enter to send</span
      >
      <div class="flex flex-col items-center md:flex-row">
        <div class="flex items-center">
          <button class="inline-button mx-2" mat-button (click)="openAgentSelector()">
            {{ agentService.selectedAgent().name }}
          </button>
        </div>
        <div class="flex items-center">
          <span class="italic">powered by</span>
          <button class="inline-button mx-2" mat-button (click)="openModelSelector()">
            {{ modelService.selectedModel().name }}
          </button>
        </div>
      </div>
    </div> `,
  styles: `
    .message-form {
      width: 100%;

      display: flex;
    }

    .inline-button {
      --mdc-text-button-container-height: 20px;
    }
  `,
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

    effect(() => {
      switch (this.messageService.status()) {
        case MessageStatus.Sending:
          this.disableForm();
          break;
        case MessageStatus.None:
          this.enableForm();
          this.messageForm.reset();
          break;
        case MessageStatus.ErrorSending:
          this.enableForm();
          break;
      }
    });
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
  }

  disableForm() {
    this.messageForm.disable();
  }

  enableForm() {
    this.messageForm.enable();
  }
}
