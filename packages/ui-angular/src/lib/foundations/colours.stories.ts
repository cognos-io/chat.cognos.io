import type { Meta, StoryObj } from '@storybook/angular';

const meta: Meta = {
  title: 'Foundations/Colours',
  parameters: {
    layout: 'padded',
  },
  render: () => ({
    template: `
      <section style="display:grid; gap: 24px; max-width: 1100px;">
        <header style="display:grid; gap: 8px; color: var(--cog-text);">
          <div style="font-size: var(--cog-fs-overline); line-height: var(--cog-lh-overline); font-weight: var(--cog-fw-overline); letter-spacing: var(--cog-ls-overline); text-transform: var(--cog-tt-overline); color: var(--cog-text-subtlest);">
            Colour tokens
          </div>
          <h1 style="margin: 0; font-family: var(--cog-font); font-size: var(--cog-fs-h-lg); line-height: var(--cog-lh-h-lg); font-weight: var(--cog-fw-h-lg);">
            Semantic token verification
          </h1>
        </header>

        <div style="display:grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));">
          <section data-theme="light" data-accent="emerald" style="display:grid; gap: 16px; padding: 20px; border-radius: var(--cog-radius-md); background: var(--cog-app-bg); color: var(--cog-text); border: 1px solid var(--cog-border);">
            <h2 style="margin: 0; font-family: var(--cog-font); font-size: var(--cog-fs-h-sm); line-height: var(--cog-lh-h-sm); font-weight: var(--cog-fw-h-sm);">Light / Emerald</h2>
            <div style="display:grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr));">
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-surface); border: 1px solid var(--cog-border);">surface</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-surface-hover); border: 1px solid var(--cog-border);">surface-hover</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-selected-bg); color: var(--cog-selected-text); border: 1px solid var(--cog-selected-border);">selected</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-brand); color: var(--cog-on-brand);">brand</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-success-bg); color: var(--cog-success-text);">success</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-info-bg); color: var(--cog-info-text);">info</div>
            </div>
            <div style="display:flex; gap: 8px; flex-wrap: wrap;">
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-neutral-bg); color: var(--cog-loz-neutral-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">neutral</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-blue-bg); color: var(--cog-loz-blue-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">blue</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-green-bg); color: var(--cog-loz-green-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">green</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-purple-bg); color: var(--cog-loz-purple-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">purple</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-red-bg); color: var(--cog-loz-red-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">red</span>
            </div>
          </section>

          <section data-theme="dark" data-accent="blue" style="display:grid; gap: 16px; padding: 20px; border-radius: var(--cog-radius-md); background: var(--cog-app-bg); color: var(--cog-text); border: 1px solid var(--cog-border);">
            <h2 style="margin: 0; font-family: var(--cog-font); font-size: var(--cog-fs-h-sm); line-height: var(--cog-lh-h-sm); font-weight: var(--cog-fw-h-sm);">Dark / Blue</h2>
            <div style="display:grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr));">
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-surface); border: 1px solid var(--cog-border);">surface</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-surface-hover); border: 1px solid var(--cog-border);">surface-hover</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-selected-bg); color: var(--cog-selected-text); border: 1px solid var(--cog-selected-border);">selected</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-brand); color: var(--cog-on-brand);">brand</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-success-bg); color: var(--cog-success-text);">success</div>
              <div style="padding: 12px; border-radius: var(--cog-radius-sm); background: var(--cog-info-bg); color: var(--cog-info-text);">info</div>
            </div>
            <div style="display:flex; gap: 8px; flex-wrap: wrap;">
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-neutral-bg); color: var(--cog-loz-neutral-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">neutral</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-blue-bg); color: var(--cog-loz-blue-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">blue</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-green-bg); color: var(--cog-loz-green-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">green</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-purple-bg); color: var(--cog-loz-purple-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">purple</span>
              <span style="padding: 2px 6px; border-radius: var(--cog-radius-xs); background: var(--cog-loz-red-bg); color: var(--cog-loz-red-fg); font-size: var(--cog-fs-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge);">red</span>
            </div>
          </section>
        </div>
      </section>
    `,
  }),
};

export default meta;

type Story = StoryObj;

export const Showcase: Story = {};
