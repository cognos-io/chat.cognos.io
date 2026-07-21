# Architecture decision records

ADRs explain durable technical choices that are difficult to infer from current code. They are not
design proposals, implementation plans or meeting transcripts.

## Add a decision

1. Copy [`0000-template.md`](./0000-template.md).
2. Use the next four-digit number and a short kebab-case filename, such as
   `0001-use-forward-only-migrations.md`.
3. Fill every section from the people who made the decision or from an explicit contemporary
   record. Do not invent historical rationale.
4. Keep the record short enough to read in about one minute.
5. Set `status: accepted`. When a decision changes, add a new ADR and set the old record to
   `superseded` with `superseded_by` populated.

## Required metadata

- `date`: decision date in `YYYY-MM-DD` format
- `status`: `accepted`, `superseded` or `deprecated`
- `decision_makers`: people or roles that approved the decision
- `supersedes` and `superseded_by`: ADR numbers or `null`

Candidate historical decisions that still need human confirmation are tracked in
[`open-points.md`](../open-points.md), not written as accepted ADRs.
