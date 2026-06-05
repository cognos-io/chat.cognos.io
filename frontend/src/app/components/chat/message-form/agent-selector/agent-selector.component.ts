import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';

import { CognosButtonComponent, CognosDialogSurfaceComponent } from '@cognos/ui-angular';

import { TagComponent } from '@app/components/tag/tag.component';
import { Agent } from '@app/interfaces/agent';
import { AgentService } from '@app/services/agent.service';

@Component({
  selector: 'app-agent-selector',
  standalone: true,
  imports: [CognosDialogSurfaceComponent, CognosButtonComponent, TagComponent],
  template: `
    <cog-dialog-surface title="Choose an agent" [footer]="true" (close)="close()">
      <div class="agent-selector">
        <div class="agent-selector__copy">
          <p>
            AI agents alter the way the model interacts with you. Each agent has its own
            capabilities that can make your chat experience more enjoyable.
          </p>
          <p>
            In future agents will also be able to take actions on your behalf, but for
            now they only customise the system prompt.
          </p>
        </div>

        <div class="agent-selector__list" role="radiogroup">
          @for (agent of agentService.agentList(); track agent.id) {
            <label class="agent-selector__card">
              <input
                class="agent-selector__radio"
                type="radio"
                name="agent"
                [checked]="newAgent.id === agent.id"
                [disabled]="agent.id === selectedAgent.id"
                (change)="newAgent = agent"
              />

              <div class="agent-selector__content">
                @if (agent.id === selectedAgent.id) {
                  <div class="agent-selector__status">Currently active</div>
                }
                <div class="agent-selector__title">{{ agent.name }}</div>
                <p class="agent-selector__description">{{ agent.description }}</p>
                @if (agent.tags && agent.tags.length > 0) {
                  <div class="agent-selector__tags">
                    @for (tag of agent.tags; track tag) {
                      <app-tag [tag]="tag"></app-tag>
                    }
                  </div>
                }
              </div>
            </label>
          }
        </div>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">Cancel</cog-button>
        <cog-button
          appearance="primary"
          [disabled]="newAgent.id === selectedAgent.id"
          (click)="onSaveAgentChange()"
        >
          Select
        </cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .agent-selector,
    .agent-selector__copy,
    .agent-selector__list,
    .agent-selector__content {
      display: grid;
      gap: var(--cog-space-150);
    }

    .agent-selector__copy p,
    .agent-selector__description {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .agent-selector__card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--cog-space-150);
      align-items: start;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
      cursor: pointer;
    }

    .agent-selector__radio {
      margin-top: 3px;
      accent-color: var(--cog-brand);
    }

    .agent-selector__status {
      color: var(--cog-success-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-caption);
      text-transform: uppercase;
      letter-spacing: var(--cog-ls-overline);
    }

    .agent-selector__title {
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
    }

    .agent-selector__tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSelectorComponent {
  private readonly _dialogRef = inject(DialogRef<Agent | undefined>);

  public readonly agentService = inject(AgentService);

  newAgent: Agent = this.agentService.selectedAgent();

  get selectedAgent() {
    return this.agentService.selectedAgent();
  }

  close() {
    this._dialogRef.close(undefined);
  }

  onSaveAgentChange() {
    this.agentService.selectAgent(this.newAgent.id);
    this._dialogRef.close(this.newAgent);
  }
}
