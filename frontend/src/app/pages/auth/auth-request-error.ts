export type AuthRequestErrorKind =
  | 'duplicate'
  | 'validation'
  | 'rateLimit'
  | 'network'
  | 'server';

interface ErrorResponse {
  status?: unknown;
  response?: {
    data?: Record<string, { code?: unknown }>;
  };
}

export function authRequestErrorKind(error: unknown): AuthRequestErrorKind {
  const response = error as ErrorResponse;
  const status = typeof response?.status === 'number' ? response.status : 0;

  if (status === 429) {
    return 'rateLimit';
  }
  if (status === 0) {
    return 'network';
  }
  if (status >= 500) {
    return 'server';
  }

  const fields = Object.values(response.response?.data ?? {});
  if (fields.some((field) => field?.code === 'validation_not_unique')) {
    return 'duplicate';
  }

  return status >= 400 && status < 500 ? 'validation' : 'server';
}
