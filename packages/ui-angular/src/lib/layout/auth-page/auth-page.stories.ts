import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosAuthPageComponent } from './auth-page.component';

const meta: Meta = {
  title: 'Layout/Auth page',
  decorators: [
    moduleMetadata({
      imports: [CognosAuthPageComponent, CognosButtonComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: `
      <cog-auth-page>
        <h1 class="auth-page__title">Welcome back</h1>
        <p class="auth-page__lead">Sign in to your encrypted workspace.</p>
        <form class="auth-page__form">
          <label class="auth-page__field">
            <span class="auth-page__label">Email</span>
            <input class="auth-page__input" type="email" placeholder="you@example.com" />
          </label>
          <label class="auth-page__field">
            <span class="auth-page__label">Password</span>
            <input class="auth-page__input" type="password" />
          </label>
          <cog-button appearance="primary" [fullWidth]="true" size="lg">Sign in</cog-button>
        </form>
        <p class="auth-page__switch"><a href="#">Forgot password?</a></p>
      </cog-auth-page>
    `,
  }),
};
