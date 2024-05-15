import { Component, inject } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

import { AgentService } from '@app/services/agent.service';

@Component({
  selector: 'app-agent-selector',
  standalone: true,
  imports: [MatAutocompleteModule, MatInputModule, MatFormFieldModule],
  template: `
    <h2>Choose an agent</h2>

    <form>
      <mat-form-field class="w-full">
        <mat-label>Agent</mat-label>
        <input
          type="text"
          placeholder="Simple agent"
          aria-label="Agent"
          matInput
          [matAutocomplete]="agentSelector"
        />
      </mat-form-field>
      <mat-autocomplete autoActiveFirstOption #agentSelector="matAutocomplete">
      </mat-autocomplete>
    </form>
  `,
  styles: ``,
})
export class AgentSelectorComponent {
  public readonly agentService = inject(AgentService);
}
