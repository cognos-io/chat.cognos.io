/**
 * Lazy PDF text extraction via pdfjs-dist. Imported only when a PDF is actually
 * processed, so it never bloats the worker bundle for text-only attachments.
 *
 * pdfjs needs its own worker. We point it at the copy emitted to `/assets`
 * (see angular.json) and let the browser spawn it as a nested worker from our
 * attachment worker — avoiding fragile bundler URL resolution.
 */
export const extractPdfText = async (bytes: Uint8Array): Promise<string> => {
  const pdfjs = await import('pdfjs-dist');

  const origin =
    typeof self !== 'undefined' && self.location ? self.location.origin : '';
  pdfjs.GlobalWorkerOptions.workerSrc = `${origin}/assets/pdf.worker.min.mjs`;

  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }
    return pages.join('\n\n');
  } finally {
    await loadingTask.destroy();
  }
};
