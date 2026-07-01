import type { Preview } from '@storybook/angular';

// The design tokens + app styles (so components render against the real --cog-*
// variables, not their inline fallbacks) are loaded via the `styles` array in
// angular.json's build-storybook target. They must not be `import`ed here: the
// token stylesheet uses `@import`, which webpack can't parse as a JS module.

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
