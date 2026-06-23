import { z } from 'zod';

import { parseBackendDate } from '@app/utils/timestamp';

/**
 * ProjectData is the decrypted metadata of a project. It is encrypted
 * client-side under the project content key and stored as the project's
 * opaque `data` blob — the server never sees these fields in plaintext.
 */
export const ProjectData = z.object({
  version: z.literal('1').default('1'),
  name: z.string().trim(),
  description: z.string().trim().default(''),
});
export type ProjectData = z.infer<typeof ProjectData>;

export interface ProjectRecord {
  id: string;
  created: string;
  updated: string;
  data: string;
  creator?: string;
  // wrapped_project_key is the symmetric project content key sealed to the
  // current user's public key, embedded in list/get responses so the client
  // can decrypt `data` without a second request.
  wrapped_project_key?: string;
  key_version: number;
  archived_at?: string;
}

/**
 * parseProjectData - decodes a decrypted JSON blob into a ProjectData object.
 */
export const parseProjectData = (decryptedData: Uint8Array): ProjectData => {
  const dataString = new TextDecoder().decode(decryptedData);
  return ProjectData.parse(JSON.parse(dataString));
};

/**
 * serializeProjectData - encodes a ProjectData object into a JSON byte string
 * ready for encryption.
 */
export const serializeProjectData = (data: ProjectData): Uint8Array => {
  const serialized = JSON.stringify(ProjectData.parse(data));
  return new TextEncoder().encode(serialized);
};

export interface Project {
  record: ProjectRecord;
  decryptedData: ProjectData;
  // contentKey is the symmetric project content key (32 bytes), held only in
  // memory for the duration of the session.
  contentKey: Uint8Array;
}

// ProjectConversationRecord is the API shape for a conversation inside a
// project. The conversation secret key is wrapped by the project content key
// (not per-participant); the client unwraps it to reconstruct the conversation
// keypair.
export interface ProjectConversationRecord {
  id: string;
  created: string;
  updated: string;
  last_activity_at?: string;
  data: string;
  project: string;
  key_version: number;
  project_key_version: number;
  wrapped_conversation_secret_key: string;
}

const updatedAtMs = (project: Project): number => {
  const time = parseBackendDate(project.record.updated).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export const sortProjectsByUpdated = (projects: Project[]): Project[] => {
  return [...projects].sort((a, b) => updatedAtMs(b) - updatedAtMs(a));
};
