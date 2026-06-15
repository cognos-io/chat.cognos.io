import { type Meta, type StoryObj, moduleMetadata } from '@storybook/angular';

import { CognosMobileShellShowcaseComponent } from './mobile-shell-showcase/mobile-shell-showcase.component';

type StoryArgs = {
  drawerOpen: boolean;
  title: string;
};

const meta: Meta<StoryArgs> = {
  title: 'Layout/Mobile Shell',
  decorators: [
    moduleMetadata({
      imports: [CognosMobileShellShowcaseComponent],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    drawerOpen: false,
    title: 'FOI request — draft reply',
  },
  render: (args) => ({
    props: args,
    template: `
      <cog-mobile-shell-showcase
        [drawerOpen]="drawerOpen"
        [title]="title"
      />
    `,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};

export const DrawerOpen: Story = {
  args: {
    drawerOpen: true,
  },
};
