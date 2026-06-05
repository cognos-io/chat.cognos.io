import type { Meta, StoryObj } from '@storybook/angular';

const meta: Meta = {
  title: 'Foundations/Typography',
  parameters: {
    layout: 'padded',
  },
  render: () => ({
    template: `
      <section style="display:grid; gap: 24px; max-width: 900px; color: var(--cog-text);">
        <header style="display:grid; gap: 8px;">
          <div style="font-size: var(--cog-fs-overline); line-height: var(--cog-lh-overline); font-weight: var(--cog-fw-overline); letter-spacing: var(--cog-ls-overline); text-transform: var(--cog-tt-overline); color: var(--cog-text-subtlest);">
            Typography tokens
          </div>
          <h1 style="margin: 0; font-family: var(--cog-font); font-size: var(--cog-fs-h-lg); line-height: var(--cog-lh-h-lg); font-weight: var(--cog-fw-h-lg); letter-spacing: var(--cog-ls-h-lg);">
            The quick brown fox jumps over the lazy dog.
          </h1>
          <p style="margin: 0; font-family: var(--cog-font); font-size: var(--cog-fs-body); line-height: var(--cog-lh-body); color: var(--cog-text-subtle);">
            Default UI font should use <code style="font-family: var(--cog-font-mono);">var(--cog-font)</code>, which currently resolves to the OS-native system font.
          </p>
        </header>

        <div style="display:grid; gap: 16px; padding: 20px; border: 1px solid var(--cog-border); border-radius: var(--cog-radius-md); background: var(--cog-surface);">
          <div style="font-family: var(--cog-font); font-size: var(--cog-fs-display); line-height: var(--cog-lh-display); font-weight: var(--cog-fw-display); letter-spacing: var(--cog-ls-display);">
            Display
          </div>
          <div style="font-family: var(--cog-font); font-size: var(--cog-fs-h-md); line-height: var(--cog-lh-h-md); font-weight: var(--cog-fw-h-md); letter-spacing: var(--cog-ls-h-md);">
            Heading medium
          </div>
          <div style="font-family: var(--cog-font); font-size: var(--cog-fs-body-lg); line-height: var(--cog-lh-body-lg); font-weight: var(--cog-fw-body-lg);">
            Body large — end-to-end encrypted chat content should feel calm, readable, and native.
          </div>
          <div style="font-family: var(--cog-font); font-size: var(--cog-fs-body); line-height: var(--cog-lh-body); font-weight: var(--cog-fw-body);">
            Body — default UI text for forms, menus, and supporting layout chrome.
          </div>
          <div style="font-family: var(--cog-font); font-size: var(--cog-fs-caption); line-height: var(--cog-lh-caption); font-weight: var(--cog-fw-caption); color: var(--cog-text-subtlest);">
            Caption — fingerprints, timestamps, metadata.
          </div>
          <div style="font-family: var(--cog-font); font-size: var(--cog-fs-lozenge); line-height: var(--cog-lh-lozenge); font-weight: var(--cog-fw-lozenge); letter-spacing: var(--cog-ls-lozenge); text-transform: var(--cog-tt-lozenge); color: var(--cog-text-subtle);">
            Lozenge / overline treatment
          </div>
        </div>

        <div style="display:grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));">
          <section style="display:grid; gap: 8px; padding: 20px; border: 1px solid var(--cog-border); border-radius: var(--cog-radius-md); background: var(--cog-surface);">
            <div style="font-size: var(--cog-fs-overline); line-height: var(--cog-lh-overline); font-weight: var(--cog-fw-overline); letter-spacing: var(--cog-ls-overline); text-transform: var(--cog-tt-overline); color: var(--cog-text-subtlest);">
              Default system font
            </div>
            <div style="font-family: var(--cog-font); font-size: var(--cog-fs-body-lg); line-height: var(--cog-lh-body-lg);">
              Pack my box with five dozen liquor jugs.
            </div>
          </section>

          <section style="display:grid; gap: 8px; padding: 20px; border: 1px solid var(--cog-border); border-radius: var(--cog-radius-md); background: var(--cog-surface);">
            <div style="font-size: var(--cog-fs-overline); line-height: var(--cog-lh-overline); font-weight: var(--cog-fw-overline); letter-spacing: var(--cog-ls-overline); text-transform: var(--cog-tt-overline); color: var(--cog-text-subtlest);">
              Noto Sans variable
            </div>
            <div style="font-family: var(--cog-font-noto); font-size: var(--cog-fs-body-lg); line-height: var(--cog-lh-body-lg);">
              Pack my box with five dozen liquor jugs.
            </div>
          </section>

          <section style="display:grid; gap: 8px; padding: 20px; border: 1px solid var(--cog-border); border-radius: var(--cog-radius-md); background: var(--cog-surface);">
            <div style="font-size: var(--cog-fs-overline); line-height: var(--cog-lh-overline); font-weight: var(--cog-fw-overline); letter-spacing: var(--cog-ls-overline); text-transform: var(--cog-tt-overline); color: var(--cog-text-subtlest);">
              Reddit Mono variable
            </div>
            <div style="font-family: var(--cog-font-mono); font-size: var(--cog-fs-body); line-height: var(--cog-lh-body);">
              const ciphertext = encrypt(message, publicKey);
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
