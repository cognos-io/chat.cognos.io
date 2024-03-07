import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

import { AuthService } from './services/auth.service';
import { take } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  title = 'frontend';

  private auth = inject(AuthService);

  constructor() {}

  async onLogin() {
    this.auth.loginWithOry().pipe(take(1)).subscribe();

    // console.log(this.pb.authStore.isValid);
    // console.log(this.pb.authStore.token);
    // console.log(this.pb.authStore.model?.['id']);
  }

  onLogout() {
    this.auth.logout();
  }

  ngOnInit(): void {
    // console.log(this.pb.authStore.isValid);
    // console.log(this.pb.authStore.token);
  }
}
