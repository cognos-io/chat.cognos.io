import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosPageHeaderComponent } from './page-header.component';

const meta: Meta = {
  title: 'Navigation/Page header',
  decorators: [
    moduleMetadata({
      imports: [CognosPageHeaderComponent, CognosButtonComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    props: {
      crumbs: [{ label: 'Settings' }, { label: 'Security', current: true }],
    },
    template: `
      <cog-page-header
        [breadcrumbs]="crumbs"
        title="Security"
        subtitle="Protect your account with a second sign-in step."
      />
    `,
  }),
};

export const WithActions: Story = {
  render: () => ({
    props: { crumbs: [{ label: 'Projects', current: true }] },
    template: `
      <cog-page-header [breadcrumbs]="crumbs" title="Projects">
        <cog-button page-header-actions appearance="primary">New project</cog-button>
      </cog-page-header>
    `,
  }),
};
