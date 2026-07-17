# Incident response and rollback

This is the repository-side operating contract. Concrete infrastructure commands, on-call contacts,
status-page credentials and image promotion live in the private deployment repository. Before paid
launch, replace every deployment-side placeholder and run one tabletop exercise.

## Roles and severity

The incident commander owns severity, coordination and the timeline. The operations lead diagnoses
and mitigates; the privacy lead assesses personal-data impact; support owns customer communication.
One person may hold several roles during beta, but every incident must name them explicitly.

| Severity | Definition                                                                                                                        | Acknowledge    | Update cadence        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------- |
| SEV-1    | Confirmed or credible key/content exposure, destructive cross-Account access, or complete paid-service outage                     | 15 minutes     | Every 30 minutes      |
| SEV-2    | Material degradation, Provider outage without a safe fallback, backup failure threatening RPO, or widespread billing/auth failure | 30 minutes     | Every 60 minutes      |
| SEV-3    | Limited failure with a workaround and no credible confidentiality or data-loss risk                                               | 1 business day | At meaningful changes |

Targets are only promises after the deployment repository names an on-call owner and alert route.
Until then, do not advertise continuous monitoring. The standard support response target is one
working week; incident acknowledgement targets apply only after the named alert route is staffed.

## Common first actions

1. Open an incident record outside the affected system; name the commander and record UTC times.
2. Preserve relevant content-free logs and configuration/version evidence. Never paste Message text,
   Account Keys, access tokens, email addresses or Paddle identifiers into incident channels.
3. Classify confidentiality, integrity, availability, billing and personal-data impact separately.
4. Contain before repairing: disable an affected Provider/feature, revoke credentials, block ingress
   or stop image promotion as appropriate.
5. Communicate what is known, affected capability and next update time. Do not speculate.

## Scenario paths

| Trigger                                            | Immediate containment                                                                                                      | Recovery and escalation                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup failed or newest usable archive exceeds RPO | Protect the current data volume; stop destructive changes; investigate repository/storage credentials without logging them | Run repository checks, create a new archive, then perform the isolated restore drill. Escalate to SEV-2 when RPO is threatened                                       |
| Provider outage or degraded responses              | Disable the Provider in the allowlist; do not send content to an unapproved substitute                                     | Use only a contractually approved Provider/residency fallback; otherwise show a content-free outage message and preserve queued user input client-side               |
| Account/authentication incident                    | Revoke affected sessions/credentials, rate-limit or disable the vulnerable path                                            | Preserve auth audit evidence, assess cross-Account access, require fresh authentication and contact affected Account holders through an approved channel             |
| Billing incident                                   | Pause checkout or the affected plan; preserve Paddle webhook IDs only in restricted billing systems                        | Reconcile against Paddle as source of truth; prevent duplicate charges; route refunds/disputes through the billing runbook                                           |
| Suspected personal-data breach                     | Treat as SEV-1; contain access; involve the privacy lead immediately                                                       | Establish data, people, jurisdictions and times affected; preserve a decision log; obtain legal advice and meet applicable authority/customer notification deadlines |

## Rollback

Rollback means promoting the last known-good immutable image digest through the deployment
repository. It does not mean reversing a database migration. Migrations are forward-only: if schema
compatibility is uncertain, stop, preserve data, and deploy a corrective forward migration. After a
rollback, run readiness plus synthetic auth, authorisation, Message encryption and mock-Completion
smoke tests before reopening traffic.

## Communication and support

- Public status updates: capability affected, start time, workaround if safe, and next update time.
- Direct customer notices: scope, recommended action and support path; avoid exposing another
  Account holder's information.
- Security/privacy reports: use the published security contact; support routes urgent reports to the
  incident commander and privacy lead.
- Close only after recovery is verified. Publish an internal review within five business days with
  impact, timeline, contributing conditions, evidence, owners and due dates. Track actions to
  closure.

## Readiness checklist

- [ ] Named primary and backup on-call owners and an alert route
- [ ] Status page and customer-support access tested
- [ ] Security contact and privacy/legal escalation tested
- [ ] Provider and billing vendor escalation contacts recorded privately
- [ ] Immutable rollback and forward-migration procedures tested
- [ ] Tabletop completed and dated; actions assigned
- [ ] Restore drill completed using [the restore runbook](restore-drill.md)
