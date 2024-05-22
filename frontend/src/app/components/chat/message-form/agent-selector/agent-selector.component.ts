import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';

import { TagComponent } from '@app/components/tag/tag.component';
import { Agent } from '@app/interfaces/agent';
import { AgentService } from '@app/services/agent.service';

@Component({
  selector: 'app-agent-selector',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatRadioModule,
    FormsModule,
    TagComponent,
  ],
  template: `
    <h2 mat-dialog-title>Choose an agent</h2>
    <mat-dialog-content>
      <p class="my-2">
        AI Agents alter the way the model interacts with you. Each agent has its own
        unique personality and capabilities that can make your chat experience more
        enjoyable. Choose an agent that you like the most.
      </p>

      <p class="my-2">
        In future Agents will be able to also take actions on your behalf like booking
        appointments, ordering food, etc. however for now they are limited to just
        changing the way the model interacts with you. (for techies, they are currently
        customizing the system prompt.)
      </p>

      <h4 class="my-4 text-lg font-semibold">Available agents:</h4>
      <mat-radio-group required="true" [(ngModel)]="newAgent" [disabled]="true">
        <ul role="list" class="divide-y divide-gray-100">
          @for (agent of agentService.agentList(); track agent.id) {
            <li class="flex items-center justify-between gap-x-6 py-6">
              <mat-radio-button [value]="agent" class="flex flex-grow gap-x-4">
                <div class="min-w-0 flex-auto">
                  <p class="text-sm font-semibold leading-6 text-gray-900">
                    {{ agent.name }}
                    @if (agent.id === selectedAgent.id) {
                      <span
                        class="mx-2 inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                        >Currently active</span
                      >
                    }
                  </p>
                  <p class="my-2 text-gray-700">{{ agent.description }}</p>
                  @if (agent.tags && agent.tags.length > 0) {
                    <div class="mt-2 flex gap-x-2">
                      @for (tag of agent.tags; track tag) {
                        <app-tag [tag]="tag"></app-tag>
                      }
                    </div>
                  }
                </div>
              </mat-radio-button>
            </li>
          }
        </ul>
      </mat-radio-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-button
        color="primary"
        [mat-dialog-close]="selectedAgent"
        [disabled]="newAgent === selectedAgent"
        (click)="onSaveAgentChange()"
      >
        Select
      </button></mat-dialog-actions
    >
  `,
  styles: ``,
})
export class AgentSelectorComponent {
  public readonly agentService = inject(AgentService);

  newAgent: Agent = this.agentService.selectedAgent();

  get selectedAgent() {
    return this.agentService.selectedAgent();
  }

  onSaveAgentChange() {
    this.agentService.selectAgent(this.newAgent.id);
  }
}
