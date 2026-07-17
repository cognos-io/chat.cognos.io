---
description: Projects group encrypted Conversations and project-scoped memory behind active project membership; production currently ships standalone Projects without team sharing
name: project-management
---

# Project Management

A **Project** is an encrypted workspace that groups Conversations and
project-scoped memory. Production currently ships standalone Projects for a
single Account's organisation; team sharing is a later phase.

Project endpoints are authenticated and gated by active project membership:

| Method   | Path                                  | Behaviour                        |
| -------- | ------------------------------------- | -------------------------------- |
| `GET`    | `/api/v1/projects`                    | List Projects visible to Account |
| `POST`   | `/api/v1/projects`                    | Create Project; creator is Admin |
| `GET`    | `/api/v1/projects/{id}`               | Read Project metadata            |
| `PATCH`  | `/api/v1/projects/{id}`               | Update Project metadata          |
| `DELETE` | `/api/v1/projects/{id}`               | Delete Project                   |
| `GET`    | `/api/v1/projects/{id}/conversations` | List Project Conversations       |
| `POST`   | `/api/v1/projects/{id}/conversations` | Create Conversation in Project   |
| `PATCH`  | `/api/v1/conversations/{id}/project`  | Move Conversation between scopes |

```mermaid
flowchart LR
  A[Create Project] --> B[Project row]
  B --> C[creator gets Admin membership]
  C --> D[Conversations can be created or moved into Project]
  D --> E[Project memory can be injected into Completions]
```

Project memory uses the same at-rest rule as Account memory: encrypted data in
storage, plaintext only in the active Completion request after client decrypt,
and Redaction before provider dispatch.

Team sharing is specified in `docs/specs/organisations.md` and remains
unmarketable until Teams v1 ships. Until then, avoid marketing Projects as
collaborative workspaces — use "organise related Conversations" rather than
"invite your team".
