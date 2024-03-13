import { Component, inject, signal } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConversationService } from '../../services/conversation.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  private readonly breakpointObserver = inject(BreakpointObserver);

  readonly conversationService = inject(ConversationService);

  isMobile = signal(false);

  constructor() {
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntilDestroyed())
      .subscribe((result) => this.isMobile.set(result.matches));
  }
}
