import { Routes } from '@angular/router';

import { authGuard } from './guards/auth.guard';
import { featureFlagGuard } from './guards/feature-flag.guard';

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
      {
        // Persona management replaces the conversation view but keeps the chat
        // sidebar. Reached from the in-chat switcher's "Manage personas" action.
        path: 'personas',
        loadComponent: () =>
          import('./pages/personas/personas-page.component').then(
            (m) => m.PersonasPageComponent,
          ),
      },
    ],
  },
  {
    // Organisation invite landing page (?token=… deep link or manual paste).
    // Auth first: accepting binds the invite to the signed-in Account — the
    // SAME account, no new identity (docs/specs/organisations.md §8.1).
    path: 'invite',
    canActivate: [authGuard, featureFlagGuard],
    data: { featureFlag: 'team' },
    loadComponent: () =>
      import('./pages/invite/invite-accept.component').then(
        (m) => m.InviteAcceptComponent,
      ),
  },
  {
    path: 'import',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/conversation-import/conversation-import').then(
        (m) => m.ConversationImport,
      ),
  },
  {
    // Standalone pricing / plan-picker ("Keep going, privately"). Reached from
    // the locked-chat surfaces and the dashboard's switch/choose actions.
    path: 'pricing',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/pricing/pricing.component').then((m) => m.PricingComponent),
  },
  {
    // Settings area: swaps the chat sidebar for a Settings nav.
    path: 'account',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/account/settings-shell.component').then(
        (m) => m.SettingsShellComponent,
      ),
    children: [
      {
        // /account is the Account home: profile, avatar, and the danger zone.
        path: '',
        data: { title: 'Account' },
        loadComponent: () =>
          import('./pages/account/account.component').then((m) => m.AccountComponent),
      },
      {
        // Personal (user-scoped) memory: view and edit the facts injected into
        // every chat.
        path: 'memory',
        data: { title: 'Memory' },
        loadComponent: () =>
          import('./pages/account/account-memory.component').then(
            (m) => m.AccountMemoryComponent,
          ),
      },
      {
        // Saved bookmarks: the highlighted spans pinned across the user's
        // chats. View the quote, jump back to the message, or remove it.
        path: 'bookmarks',
        data: { title: 'Bookmarks' },
        loadComponent: () =>
          import('./pages/account/account-bookmarks.component').then(
            (m) => m.AccountBookmarksComponent,
          ),
      },
      {
        // User-scoped attachment library: view, search, rename, download and
        // remove uploaded files, and see which chats use them.
        path: 'library',
        data: { title: 'Library' },
        loadComponent: () =>
          import('./pages/account/account-library.component').then(
            (m) => m.AccountLibraryComponent,
          ),
      },
      {
        path: 'billing',
        loadComponent: () =>
          import('./pages/account/billing/plan-billing.component').then(
            (m) => m.PlanBillingComponent,
          ),
      },
      {
        // Encrypted projects. Gated behind the `projects` feature flag while
        // sharing (phase 2) is pending.
        path: 'projects',
        canActivate: [featureFlagGuard],
        data: { featureFlag: 'projects' },
        loadComponent: () =>
          import('./pages/projects/projects-page.component').then(
            (m) => m.ProjectsPageComponent,
          ),
      },
      {
        path: 'projects/:projectId',
        canActivate: [featureFlagGuard],
        data: { featureFlag: 'projects' },
        loadComponent: () =>
          import('./pages/projects/project-detail.component').then(
            (m) => m.ProjectDetailComponent,
          ),
      },
      {
        path: 'usage',
        canActivate: [featureFlagGuard],
        data: { title: 'Usage', featureFlag: 'usage' },
        loadComponent: () =>
          import('./pages/account/settings-placeholder.component').then(
            (m) => m.SettingsPlaceholderComponent,
          ),
      },
      {
        path: 'security',
        canActivate: [featureFlagGuard],
        data: { title: 'Security & keys', featureFlag: 'security' },
        loadComponent: () =>
          import('./pages/account/account-security.component').then(
            (m) => m.AccountSecurityComponent,
          ),
      },
      {
        // Organisation admin: create org, members, invites, billing & usage
        // (docs/specs/organisations.md). Gated behind the `team` flag until
        // Teams v1 ships end-to-end.
        path: 'team',
        canActivate: [featureFlagGuard],
        data: { title: 'Team & sharing', featureFlag: 'team' },
        loadComponent: () =>
          import('./pages/account/team/team-settings.component').then(
            (m) => m.TeamSettingsComponent,
          ),
      },
      {
        path: 'notifications',
        canActivate: [featureFlagGuard],
        data: { title: 'Notifications', featureFlag: 'notifications' },
        loadComponent: () =>
          import('./pages/account/settings-placeholder.component').then(
            (m) => m.SettingsPlaceholderComponent,
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
        path: 'confirm-email-change',
        loadComponent: () =>
          import('./pages/auth/confirm-email-change/confirm-email-change.component').then(
            (m) => m.ConfirmEmailChangeComponent,
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
