import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import {
  CognosBreadcrumbsComponent,
  type CognosBreadcrumbItem,
} from "./breadcrumbs.component";

type StoryArgs = {
  items: CognosBreadcrumbItem[];
};

const meta: Meta<StoryArgs> = {
  title: "Navigation/Breadcrumbs",
  decorators: [
    moduleMetadata({
      imports: [CognosBreadcrumbsComponent],
    }),
  ],
  args: {
    items: [
      { label: "Projects" },
      { label: "Procurement" },
      { label: "Policy review", current: true },
    ],
  },
  render: (args) => ({
    props: args,
    template: `<cog-breadcrumbs [items]="items" />`,
  }),
};

export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
