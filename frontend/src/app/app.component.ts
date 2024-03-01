import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';

import PocketBase from 'pocketbase';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit {
  title = 'frontend';
  private readonly pb: PocketBase;

  constructor() {
    this.pb = new PocketBase('http://127.0.0.1:8090');
  }

  async onLogin() {
    const authData = await this.pb.collection('users').authWithOAuth2({
      provider: 'oidc',
      scopes: ['openid', 'offline_access'],
    });
    console.log(this.pb.authStore.isValid);
    console.log(this.pb.authStore.token);
    console.log(this.pb.authStore.model?.['id']);
  }

  ngOnInit(): void {
    console.log(this.pb.authStore.isValid);
    console.log(this.pb.authStore.token);
  }
}
