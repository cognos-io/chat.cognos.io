import { z } from 'zod';

export const Provider = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isOpenSource: z.boolean(),
});
export type Provider = z.infer<typeof Provider>;

const openAiProvider: Provider = {
  id: 'openai',
  name: 'OpenAI',
  description:
    'OpenAI is a research lab developing general-purpose AI which it defines as "highly autonomous systems that outperform humans at most economically valuable work."',
  isOpenSource: false,
};

const anthropicProvider: Provider = {
  id: 'anthropic',
  name: 'Anthropic',
  description:
    'Anthropic is a research lab developing general-purpose AI capable of handling medium amounts of data and that outperforms leading competitors like OpenAI on several key intelligence capabilities, such as coding and text-based reasoning.',
  isOpenSource: false,
};

const googleProvider: Provider = {
  id: 'google',
  name: 'Google',
  description:
    'Google offers advanced AI models capable of understanding large amounts of data.',
  isOpenSource: false,
};

const cloudflareProvider: Provider = {
  id: 'cloudflare',
  name: 'Cloudflare',
  description:
    'Cloudflare is a web infrastructure and website security company that host open source models on their global infrastructure.',
  isOpenSource: true,
};

const deepInfraProvider: Provider = {
  id: 'deepinfra',
  name: 'DeepInfra',
  description:
    'DeepInfra hosts open source AI models on cutting edge hardware in the cloud.',
  isOpenSource: true,
};

export const hardCodedProviders = [
  openAiProvider,
  anthropicProvider,
  googleProvider,
  cloudflareProvider,
  deepInfraProvider,
];
