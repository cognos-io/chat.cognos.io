// pdfmake@0.3.11 ships no type declarations for its browser build's UMD
// entry points. These ambient shims describe just the shape pdf-renderer.ts
// actually uses (verified empirically against a throwaway node smoke check —
// see the docs referenced in pdf-renderer.ts), so the dynamic imports there
// stay typed without resorting to `any`.
declare module 'pdfmake/build/pdfmake.js' {
  interface PdfMakeInstance {
    createPdf(docDefinition: unknown): {
      getBuffer(): Promise<ArrayBuffer | Uint8Array>;
    };
    addVirtualFileSystem?(vfs: Record<string, string>): void;
    addFontContainer?(container: {
      vfs: Record<string, string>;
      fonts: Record<string, unknown>;
    }): void;
  }
  const pdfMake: PdfMakeInstance;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts.js' {
  const vfs: Record<string, string>;
  export default vfs;
}

declare module 'pdfmake/build/standard-fonts/Courier.js' {
  const fontContainer: { vfs: Record<string, string>; fonts: Record<string, unknown> };
  export default fontContainer;
}
