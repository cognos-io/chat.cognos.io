# Documentation

Start here. Documentation should answer a current question quickly; Git history preserves obsolete
plans and implementation detail.

## Sources of truth

| Question                              | Read                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| What does the product do now?         | [Business processes](./business_processes/README.md)                              |
| What do Cognos terms mean?            | [Domain language](../CONTEXT.md)                                                  |
| What can each API route access?       | [API permissions](./api-permissions.md)                                           |
| Where can plaintext and keys exist?   | [Security model](./security-model.md)                                             |
| What remains unresolved?              | [Open points](./open-points.md)                                                   |
| Why was an architectural choice made? | [Architecture decisions](./adr/README.md)                                         |
| How is production operated?           | [Deployment interface](./deployment-interface.md) and [operations](./operations/) |
| How does an Account holder do a task? | [User guides](./user-guides/README.md)                                            |

Personas in [`personas/`](./personas/) describe the people Cognos serves. Legal material in
[`legal/`](./legal/) and operator runbooks in [`operations/`](./operations/) keep their specialised
formats because they are evidence and procedures, not product specs.

The Google sign-in journey is represented by
[Elena Rossi (PER-007)](./personas/07-google-first-account-holder.md).
Operators configure and verify its real credentials with the
[Google sign-in production checklist](./operations/google-oauth.md).

## Maintenance rules

1. Update the relevant business process in the same change as product behaviour.
2. Put unresolved work in [`open-points.md`](./open-points.md), with evidence and a recommendation.
3. Do not create implementation specs as permanent documentation. Delete completed working notes;
   Git keeps the history.
4. Record durable architectural choices as short ADRs. Do not reconstruct rationale from memory.
5. Run `rumdl fmt <file>` and `rumdl check <file>` on every Markdown file you edit.
