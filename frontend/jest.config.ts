import type { Config } from 'jest';

const config: Config = {
  verbose: true,
  globals: {
    TextEncoder: require('util').TextEncoder,
    TextDecoder: require('util').TextDecoder,
  },
};

export default config;
