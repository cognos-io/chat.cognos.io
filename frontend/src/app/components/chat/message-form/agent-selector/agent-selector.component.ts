import { Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';

import { AgentService } from '@app/services/agent.service';

@Component({
  selector: 'app-agent-selector',
  standalone: true,
  imports: [MatSelectModule, MatFormFieldModule],
  template: ``,
  styles: ``,
})
export class AgentSelectorComponent {
  public readonly agentService = inject(AgentService);
}
