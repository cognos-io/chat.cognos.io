// Shared object-URL anchor idiom for triggering a browser download of
// in-memory data (a Blob or raw bytes) under a given filename.
export const saveBlob = (
  data: Blob | Uint8Array,
  filename: string,
  mime?: string,
): void => {
  const blob =
    data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
