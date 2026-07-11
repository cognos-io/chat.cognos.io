# Backup restore drill

This runbook proves that a Cognos backup can become a usable service. A successful Borgmatic check
is useful, but it is not a restore drill. Run this in an isolated environment with production-like
storage and networking. Never restore production data to a developer workstation.

## Recovery objectives

The service owner must approve these targets before the paid beta:

| Objective | Initial beta target | Measurement                                                 |
| --------- | ------------------- | ----------------------------------------------------------- |
| RPO       | 24 hours            | Age of the newest usable archive at incident declaration    |
| RTO       | 4 hours             | Incident declaration to successful authenticated smoke test |

These are operational targets, not claims that have already been achieved. Tighten them only after
several drills and monitoring show that the target is sustainable.

## Preconditions

- The deployment repository's restore procedure, immutable image digest and secret injection are
  available to the operator.
- The isolated target cannot send real email, call paid Providers or deliver Paddle webhooks.
- The operator can read the Borg repository and decrypt the archive without copying credentials into
  this repository or the drill record.
- A second person is named to review the evidence and confirm the target is isolated.

## Drill procedure

1. Create `docs/operations/restore-drills/YYYY-MM-DD.md` from the record below. Record the start
   time, incident declaration time and latest expected recovery point in UTC.
2. Select the newest archive that existed at the declared time. Record its archive name and creation
   time, but no repository credential or customer data.
3. Restore to a new empty volume using the deployment repository procedure. Do not overwrite the
   production volume.
4. Start the exact release image by immutable digest with outbound email, Provider and Paddle access
   disabled or directed to test doubles.
5. Verify migrations complete once, the readiness endpoint succeeds, an operator can authenticate
   with a synthetic Account, encrypted records can be read by that Account, another Account cannot
   read them, and a synthetic Completion works through a mock Provider.
6. Confirm logs and the restored database contain no plaintext Message content introduced by the
   drill. Destroy the isolated restored data according to the deployment repository procedure.
7. Calculate achieved RPO and RTO, attach sanitised command output or external evidence links, and
   record every deviation. The reviewer signs the result.

## Drill record template

```markdown
# Restore drill — YYYY-MM-DD

- Status: planned | passed | failed
- Operator:
- Reviewer:
- Isolated environment:
- Release image digest:
- Archive name and created-at (UTC):
- Incident declared-at (UTC):
- Service recovered-at (UTC):
- Achieved RPO:
- Achieved RTO:
- Target met: yes | no

## Evidence

- Restore procedure revision/commit:
- Readiness and synthetic smoke-test evidence:
- Cross-Account denial evidence:
- External evidence links (access-controlled):

## Deviations and follow-up

- Finding, owner, due date:

## Disposal and review

- Isolated data destroyed-at (UTC):
- Reviewer sign-off and date:
```

Do not mark a drill `passed` when any mandatory smoke test, evidence, disposal confirmation or
reviewer sign-off is missing.
