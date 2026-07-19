import { describe, expect, it } from 'vitest';

import {
  billedOrganisationId,
  orgBlockAppliesToActiveWorkspace,
  orgBlockAppliesToConversation,
} from './org-billing-block';

const projects = [
  { record: { id: 'proj_org', organisation: 'org_1' } },
  { record: { id: 'proj_other_org', organisation: 'org_2' } },
  { record: { id: 'proj_personal' } },
];

describe('billedOrganisationId', () => {
  it.each([
    ['an org project bills its organisation', 'proj_org', 'org_1'],
    ['a personal project bills nobody', 'proj_personal', null],
    ['an unknown project bills nobody', 'proj_missing', null],
    ['no project bills nobody', undefined, null],
    ['an empty project id bills nobody', '', null],
  ])('%s', (_name, projectId, expected) => {
    expect(billedOrganisationId(projectId, projects)).toBe(expected);
  });
});

describe('orgBlockAppliesToConversation', () => {
  const block = { organisationId: 'org_1' };

  it('applies to conversations in the blocked organisation’s projects', () => {
    expect(orgBlockAppliesToConversation(block, 'proj_org', projects)).toBe(true);
  });

  // Pin: the block is scoped to ONE organisation — personal chats and other
  // orgs' projects must never carry the banner or lose their onboarding card.
  it.each([
    ['another organisation’s project', 'proj_other_org'],
    ['a personal project', 'proj_personal'],
    ['a standalone (projectless) conversation', undefined],
    ['an unknown project', 'proj_missing'],
  ])('does not apply to %s', (_name, projectId) => {
    expect(orgBlockAppliesToConversation(block, projectId, projects)).toBe(false);
  });

  it('never applies when there is no active block', () => {
    expect(orgBlockAppliesToConversation(null, 'proj_org', projects)).toBe(false);
  });

  it('never applies for a block missing its organisation id', () => {
    // A defensive guard: the parser defaults organisation_id to '' — that
    // must not accidentally match a personal (null-org) conversation.
    expect(
      orgBlockAppliesToConversation({ organisationId: '' }, 'proj_personal', projects),
    ).toBe(false);
  });
});

describe('orgBlockAppliesToActiveWorkspace', () => {
  const block = { organisationId: 'org_1' };

  it.each([
    ['the matching org workspace', 'org_1', true],
    ['the personal workspace', 'personal', false],
    ['a different org workspace', 'org_2', false],
  ])('applies in %s', (_name, workspace, expected) => {
    expect(orgBlockAppliesToActiveWorkspace(block, workspace)).toBe(expected);
  });

  it.each([
    ['no active block', null],
    ['a block missing its organisation id', { organisationId: '' }],
  ])('never applies when there is %s', (_name, activeBlock) => {
    expect(orgBlockAppliesToActiveWorkspace(activeBlock, 'org_1')).toBe(false);
  });
});
