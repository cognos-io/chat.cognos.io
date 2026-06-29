import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosButtonComponent } from '../../button/button.component';
import { CognosEmptyStateComponent } from './empty-state.component';

const meta: Meta = {
  title: 'Primitives/Empty state',
  decorators: [
    moduleMetadata({
      imports: [CognosEmptyStateComponent, CognosButtonComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Message: Story = {
  render: () => ({
    template: `<cog-empty-state message="No files yet." />`,
  }),
};

export const WithIconAndTitle: Story = {
  render: () => ({
    template: `
      <cog-empty-state
        icon="search"
        title="No results"
        message="Try a different search term."
      />
    `,
  }),
};

export const WithAction: Story = {
  render: () => ({
    template: `
      <cog-empty-state icon="folder" title="No projects" message="Create your first project to get started.">
        <cog-button appearance="primary">New project</cog-button>
      </cog-empty-state>
    `,
  }),
};
