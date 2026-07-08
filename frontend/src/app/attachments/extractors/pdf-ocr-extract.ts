/**
 * Lazy OCR fallback for scanned / text-less PDFs. Only invoked by the PDF
 * processor when the fast pdfjs text-layer pass returns nothing (spec: OCR is
 * expensive, so it is gated strictly behind the empty-text-layer condition).
 *
 * Each page is rendered to an OffscreenCanvas via pdfjs and handed to
 * tesseract.js for recognition (English only for v1). All of pdfjs, tesseract.js
 * and tesseract's core wasm + traineddata load lazily, so they never bloat the
 * worker bundle for the common (text-layer) path.
 *
 * Like pdf-extract, we serve tesseract's assets from `/assets/tesseract` (see
 * angular.json) and point workerPath/corePath/langPath at them explicitly rather
 * than relying on tesseract's CDN defaults or fragile bundler URL resolution.
 * Everything stays client-side — no page image or extracted text ever leaves the
 * browser.
 */

// Higher render scale => more legible glyphs for OCR at the cost of memory.
const OCR_RENDER_SCALE = 2;

const assetOrigin = (): string =>
  typeof self !== 'undefined' && self.location ? self.location.origin : '';

export const extractPdfOcrText = async (bytes: Uint8Array): Promise<string> => {
  const [pdfjs, tesseract] = await Promise.all([
    import('pdfjs-dist'),
    import('tesseract.js'),
  ]);

  const origin = assetOrigin();
  pdfjs.GlobalWorkerOptions.workerSrc = `${origin}/assets/pdf.worker.min.mjs`;

  const tesseractBase = `${origin}/assets/tesseract`;
  // oem left as the default (LSTM_ONLY) so tesseract loads the `-lstm` core
  // variant and the best_int traineddata we ship — the assets globbed in
  // angular.json. workerBlobURL wraps the worker script in a same-origin blob so
  // it can be spawned from inside our attachment worker.
  const worker = await tesseract.createWorker('eng', undefined, {
    workerPath: `${tesseractBase}/worker.min.js`,
    corePath: tesseractBase,
    langPath: tesseractBase,
    workerBlobURL: true,
  });

  try {
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const doc = await loadingTask.promise;
    try {
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
        const canvas = new OffscreenCanvas(viewport.width, viewport.height);
        const context = canvas.getContext(
          '2d',
        ) as unknown as CanvasRenderingContext2D | null;
        if (!context) {
          continue;
        }
        await page.render({ canvas: null, canvasContext: context, viewport }).promise;
        const {
          data: { text },
        } = await worker.recognize(canvas);
        pages.push(text);
      }
      return pages.join('\n\n');
    } finally {
      await loadingTask.destroy();
    }
  } finally {
    await worker.terminate();
  }
};
