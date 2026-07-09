/// <reference lib="webworker" />
import { detectNlpEntities } from './redaction-detectors-nlp';
import {
  detectSensitiveText,
  detectorsForMode,
  resolveOverlaps,
} from './redaction-engine';
import { RedactionCandidate } from './redaction-types';

export type RedactionWorkerRequest = {
  requestId: string;
  text: string;
  mode: 'simple' | 'better';
  locale: string;
  nlp: boolean;
};

export type RedactionWorkerResponse =
  | { type: 'result'; requestId: string; candidates: RedactionCandidate[] }
  | { type: 'error'; requestId: string };

const post = (event: RedactionWorkerResponse): void => {
  (self as unknown as Worker).postMessage(event);
};

addEventListener('message', (event: MessageEvent<RedactionWorkerRequest>) => {
  void (async () => {
    const req = event.data;
    try {
      const structured = detectSensitiveText(
        req.text,
        detectorsForMode(req.mode, req.locale),
      );
      const nlp = req.nlp ? await detectNlpEntities(req.text) : [];
      post({
        type: 'result',
        requestId: req.requestId,
        candidates: resolveOverlaps([...structured, ...nlp]),
      });
    } catch {
      post({ type: 'error', requestId: req.requestId });
    }
  })();
});
