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
};

export const defaultModel = openAiGpt35TurboModel;
