import { HttpErrorResponse } from '@angular/common/http';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parseOrgBillingRestriction } from './org-billing-restriction';

describe('parseOrgBillingRestriction', () => {
  const billing402 = (body: unknown): HttpErrorResponse =>
    new HttpErrorResponse({ status: 402, error: body });

  it.each([['ORG_BILLING_INACTIVE' as const], ['ORG_BILLING_PAST_DUE' as const]])(
    'parses an %s 402 into a structured org restriction',
    (code) => {
      const restriction = parseOrgBillingRestriction(
        billing402({
          error: code,
          organisation_id: 'org_1',
          organisation_name: 'Acme',
          message: 'Acme billing is paused.',
          admin_message: 'Update the payment method.',
        }),
      );

      expect(restriction).toEqual({
        code,
        organisationId: 'org_1',
        organisationName: 'Acme',
        message: 'Acme billing is paused.',
        adminMessage: 'Update the payment method.',
      });
    },
  );

  it('defaults missing body fields to empty strings', () => {
    const restriction = parseOrgBillingRestriction(
      billing402({ error: 'ORG_BILLING_INACTIVE' }),
    );

    expect(restriction).toEqual({
      code: 'ORG_BILLING_INACTIVE',
      organisationId: '',
      organisationName: '',
      message: '',
      adminMessage: '',
    });
  });

  it('parses the PocketBase API error envelope used by the central org write gate', () => {
    const restriction = parseOrgBillingRestriction(
      billing402({
        status: 402,
        message:
          'New messages in Acme are paused while a payment is retried. Your personal workspace still works.',
        data: {
          error: 'ORG_BILLING_PAST_DUE',
          organisation_id: 'org_1',
          organisation_name: 'Acme',
          admin_message: 'Update the payment method.',
        },
      }),
    );

    expect(restriction).toEqual({
      code: 'ORG_BILLING_PAST_DUE',
      organisationId: 'org_1',
      organisationName: 'Acme',
      message:
        'New messages in Acme are paused while a payment is retried. Your personal workspace still works.',
      adminMessage: 'Update the payment method.',
    });
  });

  it('returns null for personal billing codes', () => {
    expect(
      parseOrgBillingRestriction(billing402({ error: 'TRIAL_EXHAUSTED' })),
    ).toBeNull();
    expect(parseOrgBillingRestriction(billing402({ error: 'INACTIVE' }))).toBeNull();
  });

  it('returns null for non-402s, unknown codes and non-HTTP errors', () => {
    expect(
      parseOrgBillingRestriction(
        new HttpErrorResponse({
          status: 500,
          error: { error: 'ORG_BILLING_INACTIVE' },
        }),
      ),
    ).toBeNull();
    expect(
      parseOrgBillingRestriction(billing402({ error: 'SOMETHING_ELSE' })),
    ).toBeNull();
    expect(parseOrgBillingRestriction(billing402(null))).toBeNull();
    expect(parseOrgBillingRestriction(new Error('boom'))).toBeNull();
  });

  it('never parses a personal billing 402 as an org restriction', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('TRIAL_EXHAUSTED', 'INACTIVE'),
        fc.option(fc.string(), { nil: undefined }),
        (code, orgId) => {
          const restriction = parseOrgBillingRestriction(
            billing402({
              error: code,
              organisation_id: orgId,
            }),
          );
          expect(restriction).toBeNull();
        },
      ),
    );
  });

  it('round-trips org ids and names from arbitrary 402 bodies', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'ORG_BILLING_INACTIVE' as const,
          'ORG_BILLING_PAST_DUE' as const,
        ),
        fc.stringMatching(/^[a-z0-9_]{1,24}$/),
        fc.string({ minLength: 1, maxLength: 40 }),
        (code, orgId, orgName) => {
          const restriction = parseOrgBillingRestriction(
            billing402({
              error: code,
              organisation_id: orgId,
              organisation_name: orgName,
            }),
          );
          expect(restriction).toEqual({
            code,
            organisationId: orgId,
            organisationName: orgName,
            message: '',
            adminMessage: '',
          });
        },
      ),
    );
  });
});
