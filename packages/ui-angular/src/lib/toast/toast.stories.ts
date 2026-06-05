import { Component, inject } from "@angular/core";
import { moduleMetadata, type Meta, type StoryObj } from "@storybook/angular";

import { CognosButtonComponent } from "../button/button.component";

import { CognosToastHostComponent } from "./toast-host/toast-host.component";
import { CognosToastService } from "./toast.service";

@Component({
  selector: "story-toast-demo",
  standalone: true,
  imports: [CognosButtonComponent, CognosToastHostComponent],
  template: `
    <div style="display:flex; gap:12px; flex-wrap:wrap; min-height:240px; align-items:flex-start;">
      <cog-button appearance="primary" type="button" (click)="showSuccess()">Success toast</cog-button>
      <cog-button appearance="default" type="button" (click)="showInfo()">Info toast</cog-button>
      <cog-button appearance="danger" type="button" (click)="showDanger()">Danger toast</cog-button>
      <cog-toast-host />
    </div>
  `,
})
class ToastStoryComponent {
  private readonly toast = inject(CognosToastService);

  protected showSuccess(): void {
    this.toast.notify({
      title: "Saved to Vault",
      msg: "Keys never left this device.",
    });
  }

  protected showInfo(): void {
    this.toast.notify({
      tone: "info",
      title: "2 sources attached",
      msg: "The next reply can draw on your Vault files.",
    });
  }

  protected showDanger(): void {
    this.toast.notify({
      tone: "danger",
      title: "File shredded",
      msg: "The encryption key was destroyed.",
      action: { label: "Undo" },
    });
  }
}

const meta: Meta = {
  title: "Extension/Toast",
  decorators: [
    moduleMetadata({
      imports: [ToastStoryComponent],
    }),
  ],
};

export default meta;

type Story = StoryObj;

export const Overview: Story = {
  render: () => ({
    template: `<story-toast-demo />`,
  }),
};
