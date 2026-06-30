import type { Preview } from '@storybook/angular';

// Load the design tokens so library components render against the real
// --cog-* variables (matching the app), not their inline fallbacks.
import '@cognos/ui/tokens.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: {
      expanded: true,
    },
    backgrounds: {
      default: 'light',
      values: [
        {
          name: 'light',
          value: '#f7f8f9',
        },
        {
          name: 'dark',
          value: '#161a1d',
        },
      ],
    },
  },
};

export default preview;
