import {
  AttachmentProcessor,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';
import { extractExcelText } from '../extractors/excel-extract';
import { TextExtractor, runTextExtraction } from './text-extraction';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';

/** Extracts spreadsheets to per-sheet CSV text via SheetJS (lazy-loaded).
 * Handles `.xlsx` and legacy `.xls`. */
export class ExcelProcessor implements AttachmentProcessor {
  readonly id = 'excel';
  readonly version = '1';
  readonly supportedExtensions = ['xlsx', 'xls'] as const;
  readonly supportedMimeTypes = [XLSX_MIME, XLS_MIME] as const;
  readonly maxBytes = Number.POSITIVE_INFINITY;

  constructor(private readonly extract: TextExtractor = extractExcelText) {}

  canProcess(input: ProcessorInput): boolean {
    return (
      this.supportedExtensions.includes(
        input.detectedType.extension as (typeof this.supportedExtensions)[number],
      ) ||
      this.supportedMimeTypes.includes(input.detectedType.detectedMimeType as never)
    );
  }

  process(input: ProcessorInput): Promise<ProcessorOutput> {
    return runTextExtraction(this.extract, input, XLSX_MIME);
  }
}
