---
description: When reasoning is on, the output ceiling is floored above an explicit thinking budget so Anthropic's max_tokens > budget rule always holds
name: reasoning-output-budget
---

# Reasoning Output Budget

Anthropic models (incl. Claude on Bedrock) enforce one hard rule:
**`max_tokens` must be strictly greater than `thinking.budget_tokens`.** Break it
and the provider returns a `400` and the whole turn fails.

This is easy to break by accident: a **trial** account caps output at `8192`,
but a reasoning turn's thinking budget can be larger than that — so
`max_tokens (8192) ≤ budget` and the request 400s. Paid accounts (cap `32768`)
mostly dodged it, which made it look intermittent.

The fix: **we own the budget instead of guessing the router's.** The handler
picks an explicit budget per effort tier, sends it as `reasoning.max_tokens`,
and raises the output ceiling so it always clears the budget.

## The budget per effort tier

| Effort            | Thinking budget  |
| ----------------- | ---------------- |
| `off` / `none`    | 0 (no reasoning) |
| `low` / `minimal` | 4 096            |
| `medium`          | 8 192            |
| `high`            | 16 384           |

Then the output ceiling is:

```plain text
ceiling = max(plan_default_or_requested, budget + 4096 answer headroom)
ceiling = min(ceiling, model.max_output_tokens)   # clamp to the model
budget  = min(budget, ceiling - 4096)              # shrink if the model is tiny
# guarantee: budget < ceiling, always
```

The `+4096` headroom leaves room for the visible answer after thinking is spent.
On a trial account a `high` turn raises the ceiling to `20 480` — well past the
`8192` default — which is exactly what makes the provider call valid.

## Invariants

1. **`max_tokens > budget`, by construction.** We set both numbers, so the
   inequality can't drift with whatever budget the router would have derived
   from the effort string.
2. **The raised ceiling is priced honestly.** The
   [billing access gate](./billing-access-gate.md) estimates cost from the
   ceiling we'll actually send, so a trial reasoning turn reserves more balance
   (and may legitimately `402`) rather than overspending.
3. **Disabling means sending _no_ reasoning param — not effort `none`.**
   Requesty is a Bifrost _custom_ provider, so Bifrost forwards the reasoning
   param verbatim (it skips the normalisation it does for first-party OpenAI).
   Requesty/Bedrock reads the mere _presence_ of a reasoning param as "thinking
   on" and applies a default budget — so sending `effort: "none"` actually
   **enables** thinking, and a tiny `max_tokens` (title generation) then trips
   the 400. `off`/`none` must therefore omit the param entirely; Claude defaults
   to thinking-off. (This is why `reasoningParam` returns nil for `off`/`none`.)

## Watch out: utility completions (e.g. title generation)

New conversations get an auto-title from a **tiny** completion
(`max_tokens` ≈ 15). On a model that always reasons that would 400 instantly, so
the caller must choose an effort deliberately.

**The trap: "no effort" ≠ "no reasoning".** Omitting `reasoning_effort` doesn't
disable reasoning — it tells the provider to use _its_ default. A model with no
off tier defaults to reasoning **on**, so it reasons anyway; but because no
effort reached the backend, no budget was sized, and the router's own budget
overruns the 15-token ceiling. Omitting is the bug, not the fix.

So a utility caller picks the effort by model shape (`titleReasoningEffort` in
the frontend `message.service`):

| Model shape          | Effort sent | Why                                                                       |
| -------------------- | ----------- | ------------------------------------------------------------------------- |
| No reasoning tiers   | _omit_      | Any effort would 400 ("not supported"). This is the only safe omit.       |
| Has an `off` tier    | `off`       | Cheapest — actively disables. Omitting would reason at the model default. |
| Can't be turned off  | lowest tier | Forces the **smallest** budget; the backend then floors `max_tokens`.     |

The lowest tier (not "no effort", not the model default) is the cheapest _valid_
option for a forced-reasoning model: a title needs a few words, so we want the
minimum thinking budget, not whatever default the catalogue declares.

This fix lives caller-side by choice — the backend could fall back to a model's
`default_reasoning_effort` when no effort arrives, but that would cost more (the
default tier, not the lowest) and only one caller needs it today.

Rides the [completion pipeline](./completion-pipeline.md) and pairs with
[reasoning-visibility](./reasoning-visibility.md) (which covers how the
reasoning text itself is streamed and encrypted). When the code and this table
disagree, the code in `effectiveMaxOutputTokens` / `reasoningOutputPlan` wins.
