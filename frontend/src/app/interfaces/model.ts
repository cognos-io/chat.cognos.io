import { z } from 'zod';

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  inputContextLength: z.number(), // How many tokens can be passed to the model
  maxOutputTokens: z.number().optional(), // How many tokens can be generated
});
export type Model = z.infer<typeof Model>;

// This NEEDS to match the model in the backend as it's used
// as a fallback if the models cannot be fetched from the backend
// for whatever reason.
const openAiGpt35TurboModel: Model = {
  id: 'openai:gpt-3.5-turbo',
  name: 'Open AI - GPT 3.5 Turbo',
  slug: 'open-ai---gpt-35-turbo',
  description: 'This is the first model',
  inputContextLength: 16_385,
  tags: ['openai', 'general-purpose'],
};

const cloudflareLlama38bInstruct: Model = {
  id: 'cloudflare:llama-3-8b-instruct',
  name: 'Cloudflare - Llama3 8B Instruct',
  slug: 'cloudflare---llama3-8b-instruct',
  description: `Meta's LLama3 8B model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 8_192,
};

const cloudflarePhi2: Model = {
  id: 'cloudflare:phi-2',
  name: 'Cloudflare - Phi 2',
  slug: 'cloudflare---phi-2',
  description: `Microsoft's Phi 2 model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 2_048,
};

const cloudflareMistral7bInstruct: Model = {
  id: 'cloudflare:mistral-7b-instruct-v0.2',
  name: 'Cloudflare - Mistral 7B Instruct v0.2',
  slug: 'cloudflare---mistral-7b-instruct-v0.2',
  description: `Mistral's Mistral 7B Instruct v0.2 model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 32_768,
};

const cloudflareDeepseekMath7bInstruct: Model = {
  id: 'cloudflare:deepseek-math-7b-instruct',
  name: 'Cloudflare - Deepseek Math 7B Instruct',
  slug: 'cloudflare---deepseek-math-7b-instruct',
  description: `Deepseek AI's Deepseek Math 7B Instruct model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 4_096,
};

export const defaultModel = cloudflareLlama38bInstruct;
export const hardCodedModels = [
  openAiGpt35TurboModel,
  cloudflareLlama38bInstruct,
  cloudflarePhi2,
  cloudflareMistral7bInstruct,
  cloudflareDeepseekMath7bInstruct,
];
