---
description: Organisation Owners create and dissolve the billing boundary while admins manage policies, sessions and content-free audit evidence
name: organisation-lifecycle
---

# Organisation Lifecycle

An **Organisation** is a billing and administration boundary. The Account holder who creates it is
the Owner; paid work remains unavailable until its Paddle subscription becomes active.

| Role   | Organisation scope                                          |
| ------ | ----------------------------------------------------------- |
| Owner  | Billing, policies, members, sessions, audit and dissolution |
| Admin  | Policies, members, sessions and content-free audit          |
| Member | Work in Organisation Projects they can access               |

Owners and Admins can set a maximum privacy tier, default retention and MFA requirement. A stricter
Organisation policy constrains work in Organisation Projects; it never weakens an Account's own
setting.

Admins can revoke a member's sessions and inspect/export content-free audit rows containing only
time, action, actor and target identifiers. They cannot read Conversation titles, Messages, memory,
Attachments or Redaction mappings.

## Dissolution

Only the Owner may dissolve an Organisation, and the request must explicitly confirm deletion of
every Organisation Project. Personal Accounts, Projects and billing remain untouched.

The current handler schedules Paddle cancellation first, then deletes Organisation Projects,
revokes Memberships and stamps `dissolved_at` in one local transaction. A Paddle failure leaves
Cognos unchanged. The inverse failure window is tracked as
[OP-013](../open-points.md#product-and-security-risks) until a persisted reconciler replaces this
flow.

Account deletion is not Organisation dissolution. An Owner must transfer ownership or dissolve the
Organisation before their Account can be deleted; see
[Account deletion](./account-delete.md).
