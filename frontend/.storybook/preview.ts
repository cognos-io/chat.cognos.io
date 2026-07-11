import type { Preview } from '@storybook/angular';

const preview: Preview = {
  parameters: {
    controls: { expanded: true },
    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: '#f7f8f9' },
        { name: 'dark', value: '#161a1d' },
      ],
    },
  },
};

export default preview;
