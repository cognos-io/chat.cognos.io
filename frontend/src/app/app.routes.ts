import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { keyPairRequiredGuard } from './guards/keypair-required.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/chat/chat.component').then((m) => m.ChatComponent),
    canActivate: [authGuard],
    canActivateChild: [keyPairRequiredGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import(
            './components/chat/conversation-detail/conversation-detail.component'
          ).then((m) => m.ConversationDetailComponent),
      },
      {
        path: 'c/:conversationId',
        loadComponent: () =>
          import(
            './components/chat/conversation-detail/conversation-detail.component'
          ).then((m) => m.ConversationDetailComponent),
      },
    ],
  },
  {
    path: 'auth',
    loadComponent: () =>
      import('./pages/auth/auth.component').then((m) => m.AuthComponent),
    children: [
      {
        path: 'login',
        loadComponent: () =>
          import('./pages/auth/login/login.component').then((m) => m.LoginComponent),
      },
      {
        path: 'logout',
        loadComponent: () =>
          import('./pages/auth/logout/logout.component').then((m) => m.LogoutComponent),
      },
    ],
  },
];
