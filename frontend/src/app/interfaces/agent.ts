import { z } from 'zod';

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
  authorId: z.string(),
});
export type Agent = z.infer<typeof Agent>;

// This NEEDS to match the agent in the backend as it's used
// as a fallback if the agents cannot be fetched from the backend
// for whatever reason.
const simpleAssistantAgent: Agent = {
  id: 'cognos:simple-assistant',
  name: 'A simple assistant',
  slug: 'cognos--simple-assistant',
  description: 'This is a simple assistant that can help you with your questions.',
  authorId: 'cognos',
};

export const defaultAgent = simpleAssistantAgent;
