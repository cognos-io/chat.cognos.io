import { z } from 'zod';

import { Tag } from './tag';

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  providerId: z.string(),
  description: z.string(),
  tags: z.array(Tag).optional(),
  inputContextLength: z.number(), // How many tokens can be passed to the model
  maxOutputTokens: z.number().optional(), // How many tokens can be generated
});
export type Model = z.infer<typeof Model>;

// This NEEDS to match the model in the backend as it's used
// as a fallback if the models cannot be fetched from the backend
// for whatever reason.
const anthropicClaudeSonnet3dot5Model: Model = {
  id: 'anthropic:claude-sonnet3.5',
  name: 'Claude Sonnet 3.5',
  providerId: 'anthropic',
  slug: 'anthropic---claude-sonnet-3.5',
  description:
    "Anthropic's Claude Sonnet 3.5 is the newest model from Anthropic that promises excellent (better than OpenAI GPT4o) performance.",
  inputContextLength: 200_000,
  tags: [{ title: 'general-purpose' }],
};
const anthropicClaudeHaikuModel: Model = {
  id: 'anthropic:claude-haiku',
  name: 'Claude Haiku',
  providerId: 'anthropic',
  slug: 'anthropic---claude-haiku',
  description: "Anthropic's Claude Haiku is their fastest general purpose model.",
  inputContextLength: 200_000,
  tags: [{ title: 'fast' }],
};
const anthropicClaudeSonnetModel: Model = {
  id: 'anthropic:claude-sonnet',
  name: 'Claude Sonnet',
  providerId: 'anthropic',
  slug: 'anthropic---claude-sonnet',
  description:
    "Anthropic's Claude Sonnet is a mid level general purpose model balancing speed and intelligence.",
  inputContextLength: 200_000,
  tags: [{ title: 'general-purpose' }],
};

const anthropicClaudeOpusModel: Model = {
  id: 'anthropic:claude-opus',
  name: 'Claude Opus',
  providerId: 'anthropic',
  slug: 'anthropic---claude-opus',
  description:
    "Anthropic's Claude Opus is an advanced intelligence general purpose model.",
  inputContextLength: 200_000,
  tags: [
    { title: 'general-purpose' },
    { title: 'high-intelligence' },
    { title: 'slow' },
  ],
};

const openAiGpt35TurboModel: Model = {
  id: 'openai:gpt-3.5-turbo',
  name: 'GPT 3.5 Turbo',
  providerId: 'openai',
  slug: 'open-ai---gpt-35-turbo',
  description: "OpenAI's fast, inexpensive model for general-purpose use.",
  inputContextLength: 16_385,
  tags: [{ title: 'general-purpose' }, { title: 'fast' }],
};

const openAiGpt4oModel: Model = {
  id: 'openai:gpt-4o',
  name: 'GPT 4 Omni',
  providerId: 'openai',
  slug: 'open-ai---gpt-4o',
  description: "OpenAI's GPT 4 Omni (GPT4o) model",
  inputContextLength: 128_000,
  tags: [{ title: 'general-purpose' }, { title: 'high-intelligence' }],
};

const googleGemini15FlashModel: Model = {
  id: 'google:gemini-1.5-flash',
  name: 'Gemini 1.5 Flash',
  providerId: 'google',
  slug: 'google---gemini-15-flash',
  description: `Google's Gemini 1.5 Flash model is a fast, general-purpose model with a long context.`,
  inputContextLength: 1_048_576,
  tags: [{ title: 'general-purpose' }, { title: 'long-context' }, { title: 'fast' }],
};

const googleGemini15ProModel: Model = {
  id: 'google:gemini-1.5-pro',
  name: 'Gemini 1.5 Pro',
  providerId: 'google',
  slug: 'google---gemini-15-pro',
  description: `Google's Gemini 1.5 Pro is an advanced, general purpose model with a long context. It is slower than the Flash model but has higher intelligence.`,
  inputContextLength: 1_048_576,
  tags: [
    { title: 'general-purpose' },
    { title: 'long-context' },
    { title: 'high-intelligence' },
  ],
};

const deepInfraOpenChat368B: Model = {
  id: 'deepinfra:openchat-3.6-8b',
  name: 'OpenChat 3.6 8B',
  providerId: 'deepinfra',
  slug: 'deepinfra---openchat-36-8b',
  description:
    'OpenChat is a LLama-3-8B fine-tune that outperforms it on multiple benchmarks.',
  inputContextLength: 8_192,
  tags: [{ title: 'open-source' }, { title: 'coding' }, { title: 'general-purpose' }],
};
const deepInfraWizardLm28x22b: Model = {
  id: 'deepinfra:wizardlm-2-8x22b',
  name: 'WizardLM-2 8x22B',
  providerId: 'deepinfra',
  slug: 'deepinfra---wizardlm-2-8x22b',
  description:
    'Developed at Microsoft, WizardLM-2 is a mixture of experts model that extends Mixtral-8x22B and is capable of general-purpose tasks.',
  inputContextLength: 64_000,
  tags: [
    { title: 'open-source' },
    { title: 'coding' },
    { title: 'general-purpose' },
    { title: 'mixture-of-experts' },
  ],
};
const deepInfraGemma117bit: Model = {
  id: 'deepinfra:gemma-1.1-7b-it',
  name: 'Gemma 1.1 7B IT',
  providerId: 'deepinfra',
  slug: 'deepinfra---gemma-11-7b-it',
  description:
    'Developed by Google, Gemma is an open-source model that leverages the same research and technology as Google Gemini models.',
  inputContextLength: 8_192,
  tags: [{ title: 'open-source' }, { title: 'general-purpose' }],
};
const deepInfraDolphin26mixtral8x7b: Model = {
  id: 'deepinfra:dolphin-2.6-mixtral-8x7b',
  name: 'Dolphin 2.6 Mixtral 8x7B',
  providerId: 'deepinfra',
  slug: 'deepinfra---dolphin-26-mixtral-8x7b',
  description:
    'Dolphin is an uncensored model that is capable of general-purpose and coding tasks.',
  inputContextLength: 16_000,
  tags: [
    { title: 'explicit' },
    { title: 'open-source' },
    { title: 'general-purpose' },
    { title: 'coding' },
  ],
};
const deepInfraChronosHermes13bv2: Model = {
  id: 'deepinfra:chronos-hermes-13b-v2',
  name: 'Chronos Hermes 13B v2',
  providerId: 'deepinfra',
  slug: 'deepinfra---chronos-hermes-13b-v2',
  description:
    'Optimized for creative writing tasks, Chronos Hermes is focused on chat, role play and story writing, with good reasoning and logic.',
  inputContextLength: 4_096,
  tags: [{ title: 'open-source' }, { title: 'creative-writing' }],
};
const deepInfraPhindCodeLlama34bv2: Model = {
  id: 'deepinfra:phind-codellama-34b-v2',
  name: 'Phind CodeLLama 34B v2',
  providerId: 'deepinfra',
  slug: 'deepinfra---phind-codellama-34b-v2',
  description:
    'Phind CodeLLama is a model optimized for coding tasks and performs well with multiple programming languages including Python, C/C++, TypeScript, Java.',
  inputContextLength: 4_096,
  tags: [{ title: 'open-source' }, { title: 'coding' }],
};
const deepInfraCodeGemma7bit: Model = {
  id: 'deepinfra:codegemma-7b-it',
  name: 'CodeGemma 7B IT',
  providerId: 'deepinfra',
  slug: 'deepinfra---codegemma-7b-it',
  description:
    'This model is intended to answer questions about code fragments, to generate code from natural language, or to engage in a conversation with the user about programming or technical problems.',
  inputContextLength: 8_192,
  tags: [{ title: 'open-source' }, { title: 'coding' }],
};
const deepInfraLlama38binstruct: Model = {
  id: 'deepinfra:llama-3-8b-instruct',
  name: 'LLama 3 8B Instruct',
  providerId: 'deepinfra',
  slug: 'deepinfra---llama-3-8b-instruct',
  description: `Meta's open source LLama3 8B model hosted on the DeepInfra infrastructure`,
  inputContextLength: 8_192,
  tags: [{ title: 'open-source' }, { title: 'general-purpose' }],
};
const deepInfraLzlv70bfp16hf: Model = {
  id: 'deepinfra:lzlv_70b_fp16_hf',
  name: 'LZLV 70B FP16 HF',
  providerId: 'deepinfra',
  slug: 'deepinfra---lzlv-70b-fp16-hf',
  description:
    'A mix of models focused on creative writing such as role playing and story telling.',
  inputContextLength: 8_192,
  tags: [
    { title: 'explicit' },
    { title: 'open-source' },
    { title: 'creative-writing' },
  ],
};

const cloudflareLlama38bInstruct: Model = {
  id: 'cloudflare:llama-3-8b-instruct',
  name: 'Llama3 8B Instruct',
  providerId: 'cloudflare',
  slug: 'cloudflare---llama3-8b-instruct',
  description: `Meta's open source LLama3 8B model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 8_192,
  tags: [{ title: 'open-source' }, { title: 'meta' }, { title: 'general-purpose' }],
};

const cloudflareQwen157BChat: Model = {
  id: 'cloudflare:qwen-15-7b-chat',
  name: 'Qwen 1.5 7B Chat',
  providerId: 'cloudflare',
  slug: 'cloudflare---qwen-15-7b-chat',
  description: `Qwen's Qwen 1.5 7B Chat model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 32_768,
  tags: [
    { title: 'open-source' },
    { title: 'qwen' },
    { title: 'open-source' },
    { title: 'fast' },
  ],
};

const cloudflareMistral7bInstruct: Model = {
  id: 'cloudflare:mistral-7b-instruct-v0.2',
  name: 'Mistral 7B Instruct v0.2',
  providerId: 'cloudflare',
  slug: 'cloudflare---mistral-7b-instruct-v0.2',
  description: `Mistral's Mistral 7B Instruct v0.2 model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 32_768,
  tags: [{ title: 'mistral' }, { title: 'open-source' }],
};

const cloudflareDeepseekMath7bInstruct: Model = {
  id: 'cloudflare:deepseek-math-7b-instruct',
  name: 'Deepseek Math 7B Instruct',
  providerId: 'cloudflare',
  slug: 'cloudflare---deepseek-math-7b-instruct',
  description: `Deepseek AI's Deepseek Math 7B Instruct model hosted on the Cloudflare Workers AI infrastructure`,
  inputContextLength: 4_096,
  tags: [
    { title: 'open-source' },
    { title: 'deepseek' },
    { title: 'open-source' },
    { title: 'maths' },
  ],
};

export const defaultModel = openAiGpt35TurboModel;
export const hardCodedModels = [
  // Anthropic
  anthropicClaudeSonnet3dot5Model,
  anthropicClaudeHaikuModel,
  anthropicClaudeSonnetModel,
  anthropicClaudeOpusModel,
  // OpenAI
  openAiGpt35TurboModel,
  openAiGpt4oModel,
  // Google Gemini
  googleGemini15FlashModel,
  googleGemini15ProModel,
  // Cloudflare
  cloudflareLlama38bInstruct,
  cloudflareQwen157BChat,
  cloudflareMistral7bInstruct,
  cloudflareDeepseekMath7bInstruct,
  // DeepInfra
  deepInfraOpenChat368B,
  deepInfraWizardLm28x22b,
  deepInfraGemma117bit,
  deepInfraDolphin26mixtral8x7b,
  deepInfraChronosHermes13bv2,
  deepInfraPhindCodeLlama34bv2,
  deepInfraCodeGemma7bit,
  deepInfraLlama38binstruct,
  deepInfraLzlv70bfp16hf,
];
