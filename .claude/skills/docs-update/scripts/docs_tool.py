#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Maintain the /docs catalogue (`docs.*`) in web/src/i18n/locales/<lang>.json.

The docs content lives inside the i18n catalogues. This tool edits only the
`docs` block, leaving every other byte untouched (Prettier-compatible
serialiser), so diffs stay tight. Subcommands:

  extract <lang> [-o FILE]    Write that locale's `docs` object as standalone
                              JSON (feed en to translation subagents).
  apply <lang> <patch.json>   Deep-merge a docs patch into <lang> (English
                              content edits). Pages: a provided slug replaces
                              that page; nav/meta/home merge by key.
  replace <lang> <docs.json>  Replace the whole `docs` block (spliced
                              translations); refuses if its key tree differs
                              from en.json's.
  check                       Report locale key-tree parity, articles with no
                              figure, missing figure files, and empty-array
                              blocks. Exit non-zero on any parity mismatch.

Repo is found via COGNOS_REPO or relative to this file. No third-party deps.
The serialiser matches the locale files' style closely; a couple of arrays may
wrap differently from Prettier at the 80-column boundary — harmless, the
pre-commit Prettier hook normalises it (content is never changed).
"""
import json
import os
import sys
from pathlib import Path

LANGS = ["en", "de", "fr", "es", "pt", "it"]
REPO = Path(os.environ.get("COGNOS_REPO") or Path(__file__).resolve().parents[4])
LOCALES = REPO / "web/src/i18n/locales"
MEDIA = REPO / "web/public/docs-media"
PRINT_WIDTH = 80
INDENT = "  "


# --- Prettier-compatible JSON serialiser (matches the locale files' style) ---
def _enc(s):
    return json.dumps(s, ensure_ascii=False)


def _dumps(v, level):
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = list(v.items())
        lines = ["{"]
        for i, (k, val) in enumerate(items):
            comma = "," if i < len(items) - 1 else ""
            lines.append(f"{INDENT * (level + 1)}{_enc(k)}: {_dumps(val, level + 1)}{comma}")
        lines.append(f"{INDENT * level}}}")
        return "\n".join(lines)
    if isinstance(v, list):
        if not v:
            return "[]"
        kids = [_dumps(x, level + 1) for x in v]
        if all("\n" not in c for c in kids):
            one = "[" + ", ".join(kids) + "]"
            if len(INDENT * level) + len(one) <= PRINT_WIDTH:
                return one
        lines = ["["]
        for i, c in enumerate(kids):
            lines.append(f"{INDENT * (level + 1)}{c}{',' if i < len(kids) - 1 else ''}")
        lines.append(f"{INDENT * level}]")
        return "\n".join(lines)
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return json.dumps(v)
    return _enc(v)


# --- string-aware span of a top-level `"key": {...}` value -------------------
def _find_key_span(text, key):
    idx = text.find(f'"{key}":')
    if idx == -1:
        return None
    line_start = text.rfind("\n", 0, idx) + 1
    i = text.find("{", idx)
    depth, in_str, esc = 0, False, False
    while i < len(text):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return (line_start, i + 1)
        i += 1
    raise ValueError("unbalanced braces")


def _write_docs(lang, docs):
    """Splice `docs` into <lang>.json, preserving all other content."""
    path = LOCALES / f"{lang}.json"
    text = path.read_text(encoding="utf-8")
    span = _find_key_span(text, "docs")
    if span:
        pre = text[: span[0]].rstrip().rstrip(",")
        post = text[span[1] :].lstrip().lstrip(",").lstrip()
        text = pre + "\n" + post
    close = text.rstrip().rfind("}")
    head = text[:close].rstrip().rstrip(",")
    block = '  "docs": ' + _dumps(docs, 0).replace("\n", "\n  ")
    new = head + ",\n" + block + "\n}\n"
    json.loads(new)  # validate
    path.write_text(new, encoding="utf-8")


def _load_docs(lang):
    return json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))["docs"]


def _key_tree(v, prefix=""):
    if isinstance(v, dict):
        return [k2 for k in sorted(v) for k2 in _key_tree(v[k], f"{prefix}.{k}")]
    if isinstance(v, list):
        out = [f"{prefix}[]"]
        for i, x in enumerate(v):
            out += _key_tree(x, f"{prefix}[{i}]")
        return out
    return [prefix]


def _deep_merge(dst, patch):
    for k, val in patch.items():
        if k == "pages" and isinstance(val, dict):
            dst.setdefault("pages", {})
            for slug, page in val.items():
                dst["pages"][slug] = page  # whole-page replace
        elif isinstance(val, dict) and isinstance(dst.get(k), dict):
            _deep_merge(dst[k], val)
        else:
            dst[k] = val
    return dst


# --- subcommands -------------------------------------------------------------
def cmd_extract(args):
    lang = args[0]
    out = None
    if len(args) >= 3 and args[1] == "-o":
        out = args[2]
    data = json.dumps(_load_docs(lang), ensure_ascii=False, indent=2)
    if out:
        Path(out).write_text(data + "\n", encoding="utf-8")
        print(f"wrote {out} ({len(_load_docs(lang)['pages'])} pages)")
    else:
        print(data)


def cmd_apply(args):
    lang, patch_file = args[0], args[1]
    docs = _load_docs(lang)
    patch = json.loads(Path(patch_file).read_text(encoding="utf-8"))
    _write_docs(lang, _deep_merge(docs, patch))
    print(f"applied patch to {lang}.json ({len(_load_docs(lang)['pages'])} pages)")


def cmd_replace(args):
    lang, docs_file = args[0], args[1]
    new = json.loads(Path(docs_file).read_text(encoding="utf-8"))
    en_tree = _key_tree(_load_docs("en"))
    if _key_tree(new) != en_tree:
        se, sn = set(en_tree), set(_key_tree(new))
        print(f"STRUCTURE MISMATCH vs en: missing {sorted(se - sn)[:8]} extra {sorted(sn - se)[:8]}")
        sys.exit(1)
    _write_docs(lang, new)
    print(f"replaced docs in {lang}.json ({len(new['pages'])} pages)")


def _page_has_figure(page):
    return any("figure" in b for s in page.get("sections", []) for b in s.get("blocks", []))


def cmd_check(_args):
    en = _load_docs("en")
    en_tree = _key_tree(en)
    problems = 0

    print("== locale parity (vs en) ==")
    for lang in LANGS[1:]:
        try:
            tree = _key_tree(_load_docs(lang))
        except Exception as e:
            print(f"  {lang}: ERROR {e}")
            problems += 1
            continue
        missing, extra = sorted(set(en_tree) - set(tree)), sorted(set(tree) - set(en_tree))
        if missing or extra:
            problems += 1
            print(f"  {lang}: MISMATCH missing={missing[:5]} extra={extra[:5]}")
        else:
            print(f"  {lang}: ok ({len(_load_docs(lang)['pages'])} pages)")

    print("== articles with no figure ==")
    nofig = [s for s, p in en["pages"].items() if not _page_has_figure(p)]
    print("  " + (", ".join(nofig) if nofig else "(none — every article has a figure)"))

    print("== figure files referenced but missing (en) ==")
    missing_files = []
    for slug, p in en["pages"].items():
        for s in p.get("sections", []):
            for b in s.get("blocks", []):
                src = b.get("figure", {}).get("src") if "figure" in b else None
                if src and not src.startswith("http") and not (MEDIA.parent / src.lstrip("/")).exists():
                    missing_files.append((slug, src))
    print("  " + (", ".join(f"{s}:{src}" for s, src in missing_files) if missing_files else "(none)"))

    print("== localised screenshot coverage ==")
    for lang in LANGS[1:]:
        d = MEDIA / lang
        print(f"  {lang}: {len(list(d.glob('*.png'))) if d.exists() else 0} localised shots")

    if problems:
        print(f"\nFAIL: {problems} locale parity problem(s).")
        sys.exit(1)
    print("\nOK.")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    cmd, args = sys.argv[1], sys.argv[2:]
    {"extract": cmd_extract, "apply": cmd_apply, "replace": cmd_replace, "check": cmd_check}[cmd](args)


if __name__ == "__main__":
    main()
