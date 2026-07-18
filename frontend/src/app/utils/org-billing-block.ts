// Helpers for scoping an Organisation billing block (an ORG_BILLING_* 402 from
// /complete, held in BillingService.orgSendBlock) to the conversation on
// screen. A block belongs to ONE Organisation: it must only surface on
// conversations in that org's Projects — personal chats and other orgs'
// Projects never carry the banner. Shared by the chat page (banner) and the
// conversation detail (onboarding-card suppression) so the two surfaces can
// never disagree.

/**
 * billedOrganisationId - the Organisation id a conversation bills to, resolved
 * through its Project (an org-owned Project bills the org), or null when the
 * conversation is personal (no project, unknown project, or a personal
 * project).
 */
export const billedOrganisationId = (
  projectId: string | null | undefined,
  projects: ReadonlyArray<{ record: { id: string; organisation?: string } }>,
): string | null => {
  if (!projectId) {
    return null;
  }
  return (
    projects.find((project) => project.record.id === projectId)?.record.organisation ??
    null
  );
};

/**
 * orgBlockAppliesToConversation - whether an active org billing block applies
 * to the conversation identified by `projectId`.
 */
export const orgBlockAppliesToConversation = (
  block: { organisationId: string } | null,
  projectId: string | null | undefined,
  projects: ReadonlyArray<{ record: { id: string; organisation?: string } }>,
): boolean =>
  block !== null &&
  block.organisationId !== '' &&
  billedOrganisationId(projectId, projects) === block.organisationId;
