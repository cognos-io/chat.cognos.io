# Cognos

This is the monorepo for [cognos.io](https://cognos.io/), an AI chat application like ChatGPT that
encrypts user messages server side that can only be decrypted by the user. This is a similar
approach to ProtonMail which encrypts user emails.

## Project structure

- `backend/` the Go API. Powered by Pocketbase,
- `frontend/` an Angular application. The chat interface that decrypts messages, sends to the
  backend etc.
- `web/` marketing pages in Astro

## Guidelines

- Security is a top priority. We must make sure that we never log user data including chat contents.
  Chats must be encrypted as soon as possible.
- Simple is secure. Keep things idomatic. Prefer declarative over imperative.
- Use Dash docs skill if need to look up Pocketbase or Angular documentation as they are releasing
  new features which changes the overall behaviour and syntax at times
- When scaffolding, run the relevant commands don't just write files. For example, run `pnpm init`
  and NOT just write a `package.json` file. Use the `ng` CLI via `pnpm` to scaffold angular services
  and components etc.

## Tools

| Use       | Don't use            |
| --------- | -------------------- |
| `pnpm`    | `npm`, `yarn`        |
| `podman`  | `docker`             |
| `just`    | `make`               |
| `mise`    | `gvm`, `nvm`, `asdf` |
| `python3` | `python`             |
| `uv`      | `pip`                |
