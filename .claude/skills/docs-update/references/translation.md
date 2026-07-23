# Translating the docs catalogue

Docs ship in six languages. Translate **after** the English is final and
adversarially reviewed. Delegate one `fast-worker` subagent per non-English
locale (de, fr, es, pt, it) so the orchestrator's context stays small, then
splice each result back with a structure check.

## Steps

1. Extract the current English docs:
   ```
   python3 .claude/skills/docs-update/scripts/docs_tool.py extract en -o /tmp/docs_en.json
   ```
2. Spawn 5 `fast-worker` subagents in parallel (one per locale) with the prompt
   template below. Each writes `/tmp/<lang>.json`.
3. Splice each with the parity guard (refuses on key-tree mismatch):
   ```
   python3 .claude/skills/docs-update/scripts/docs_tool.py replace <lang> /tmp/<lang>.json
   ```
4. `cd web && pnpm build && pnpm test`; then `docs_tool.py check`.

For a **tiny** English change (a sentence or two), skip the subagents: translate
the changed strings yourself and edit the locale files directly (or via
`docs_tool.py apply <lang> patch.json`) — but keep key trees identical.

## Per-locale variant rules

| Lang | Variant | Watch out for |
| --- | --- | --- |
| de | Swiss Standard German (de-CH) | **`ss`, never `ß`**; informal **du** |
| fr | French (fr-CH/standard) | polite **vous** |
| es | European Spanish (es-ES) | `ordenador`/`móvil`; informal **tú** |
| pt | European Portuguese (pt-PT) | `ecrã`/`palavra-passe`/`contacto`; informal **tu**, not você |
| it | Italian (it-CH/standard) | informal **tu** |

## Subagent prompt template

Fill `<LANG NAME>`, `<lang>`, and the variant rule. Keep the rest verbatim.

> Translate a JSON documentation catalogue from English into **<LANG NAME>**.
>
> SOURCE (read fully): /tmp/docs_en.json
> WRITE TO: /tmp/<lang>.json
>
> End-user help for Cognos, an encrypted AI chat app.
>
> RULES: <variant rule from the table>. Natural, plain help-desk register.
>
> PRESERVE EXACTLY (translate only string VALUES): identical JSON keys, nesting,
> array order and lengths. Keep HTML tags `<b>/<a>/<code>`; keep every `href="…"`
> byte-for-byte; keep `<code>` filenames/tokens/shortcuts (`cognos-emergency-kit.txt`,
> `[[PII_IBAN_Q7K9M2]]`, `Ctrl/Cmd + Enter`, `DELETE`, `.zip`, `.json`, `#`,
> `&lsaquo; 1/2 &rsaquo;`); keep `{{ }}` placeholders; keep brands (Cognos, Paddle,
> Argon2id, ChatGPT, Claude, Requesty), CHF and numbers. In `figure` blocks
> translate `alt` and `caption` but keep `src` unchanged.
>
> UI-LABEL ACCURACY: text inside `<b>` is often a literal app button/label — reuse
> the app's own <LANG NAME> wording from `frontend/src/assets/i18n/<lang>.json`
> where it exists; likewise for domain terms (Account Key, Emergency Kit, Vault,
> Conversation, Persona, Redaction, Privacy tier, Plan, Organisation, Seat,
> Project, Bookmark). Keep "Pay as you go"/"Unlimited" plan names as the app writes them.
>
> OUTPUT: valid UTF-8 JSON (raw accents, no \u escapes); top-level keys exactly
> meta, nav, home, pages. Verify it parses and report the page count + anything
> you could not confidently translate.

After splicing, spot-check one locale (e.g. German for `ß` and du-form) with a
quick `omp` read-only pass if the change was substantial.
