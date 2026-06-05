import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import type { CognosVaultFilter } from "../vault.types";

import { CognosFilterChipsComponent } from "./filter-chips.component";

type StoryArgs = {
  change: (value: CognosVaultFilter) => void;
  value: CognosVaultFilter;
};

const meta: Meta<StoryArgs> = {
  title: "Extension/Vault/Filter Chips",
  decorators: [moduleMetadata({ imports: [CognosFilterChipsComponent] })],
  argTypes: {
    value: { control: "inline-radio", options: ["all", "doc", "image", "sheet", "audio"] },
    change: { action: "change" },
  },
  args: {
    value: "all",
  },
  render: (args) => ({
    props: args,
    template: `<cog-filter-chips [value]="value" (change)="change($event)" />`,
  }),
};

export default meta;
type Story = StoryObj<StoryArgs>;

export const Default: Story = {};
