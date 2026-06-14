import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./pages/chat/chat.component').then((m) => m.ChatComponent),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./components/chat/conversation-detail/conversation-detail.component').then(
            (m) => m.ConversationDetailComponent,
          ),
      },
      {
        path: 'c/:conversationId',
        loadComponent: () =>
          import('./components/chat/conversation-detail/conversation-detail.component').then(
            (m) => m.ConversationDetailComponent,
          ),
      },
    ],
  },
  {
    // Public, unauthenticated read view for a shared conversation. The token
    // is in the path; the decryption key rides in the URL fragment (#...),
    // which the browser never sends to the server.
    path: 'p/:token',
    loadComponent: () =>
      import('./pages/public-conversation/public-conversation.component').then(
        (m) => m.PublicConversationComponent,
      ),
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
        path: 'register',
        loadComponent: () =>
          import('./pages/auth/register/register.component').then(
            (m) => m.RegisterComponent,
          ),
      },
      {
        path: 'forgot-password',
        loadComponent: () =>
          import('./pages/auth/forgot-password/forgot-password.component').then(
            (m) => m.ForgotPasswordComponent,
          ),
      },
      {
        path: 'reset-password',
        loadComponent: () =>
          import('./pages/auth/reset-password/reset-password.component').then(
            (m) => m.ResetPasswordComponent,
          ),
      },
      {
        path: 'verify-email',
        loadComponent: () =>
          import('./pages/auth/verify-email/verify-email.component').then(
            (m) => m.VerifyEmailComponent,
          ),
      },
      {
        path: 'logout',
        loadComponent: () =>
          import('./pages/auth/logout/logout.component').then((m) => m.LogoutComponent),
      },
    ],
  },
];
