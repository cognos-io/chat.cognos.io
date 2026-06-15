import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosDesktopShellShowcaseComponent } from './desktop-shell-showcase/desktop-shell-showcase.component';

type StoryArgs = {
  title: string;
};

const meta: Meta<StoryArgs> = {
  title: 'Layout/Desktop Shell',
  decorators: [
    moduleMetadata({
      imports: [CognosDesktopShellShowcaseComponent],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    title: 'FOI request — draft reply',
  },
  render: (args) => ({
    props: args,
    template: `<cog-desktop-shell-showcase [title]="title" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
