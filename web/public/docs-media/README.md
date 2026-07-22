# Docs screenshots

Cropped screenshots for the documentation site (`/docs/*`), captured from the
app. A `figure` block in `src/lib/docs.ts` content renders only when its file
exists here (see `DocsBlock.astro`), so missing screenshots never show as a
broken image — they simply appear once added.

Naming: `<slug-topic>.png`, e.g. `emergency-kit-dialog.png`, `model-picker.png`.
