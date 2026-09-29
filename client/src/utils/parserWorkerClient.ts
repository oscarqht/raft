import { AgentStep } from '../types';
import {
  stripAnsi as stripAnsiSync,
  parseLegacyThoughtToSteps as parseLegacyThoughtToStepsSync,
  parseLegacyActionLine,
} from '../workers/parser.worker';

export { stripAnsiSync, parseLegacyThoughtToStepsSync, parseLegacyActionLine };

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: any) => void;
}

let workerInstance: Worker | null = null;
const pendingRequests = new Map<string, PendingRequest>();
let reqIdSeq = 0;

// In-memory cache for fast repeated lookups
const thoughtCache = new Map<string, AgentStep[]>();
const ansiCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

function trimCache<K, V>(cache: Map<K, V>) {
  if (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(
        new URL('../workers/parser.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerInstance.onmessage = (e: MessageEvent<{ id: string; result: any; error: string | null }>) => {
        const { id, result, error } = e.data;
        const pending = pendingRequests.get(id);
        if (pending) {
          pendingRequests.delete(id);
          if (error) {
            pending.reject(new Error(error));
          } else {
            pending.resolve(result);
          }
        }
      };
      workerInstance.onerror = (err) => {
        console.error('Parser worker error:', err);
      };
    } catch (e) {
      console.warn('Could not initialize parser worker, falling back to main thread:', e);
      workerInstance = null;
    }
  }
  return workerInstance;
}

export function stripAnsi(text: string): string {
  if (!text) return '';
  if (text.length < 500) {
    return stripAnsiSync(text);
  }
  const cached = ansiCache.get(text);
  if (cached !== undefined) return cached;

  const result = stripAnsiSync(text);
  ansiCache.set(text, result);
  trimCache(ansiCache);
  return result;
}

export async function parseThoughtAsync(thoughtText: string): Promise<AgentStep[]> {
  if (!thoughtText) return [];
  const cached = thoughtCache.get(thoughtText);
  if (cached) return cached;

  // For short strings, synchronous execution is faster than worker postMessage serialization
  if (thoughtText.length < 500) {
    const result = parseLegacyThoughtToStepsSync(thoughtText);
    thoughtCache.set(thoughtText, result);
    trimCache(thoughtCache);
    return result;
  }

  const worker = getWorker();
  if (!worker) {
    const result = parseLegacyThoughtToStepsSync(thoughtText);
    thoughtCache.set(thoughtText, result);
    trimCache(thoughtCache);
    return result;
  }

  const id = `req-${++reqIdSeq}-${Date.now()}`;
  return new Promise<AgentStep[]>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: (res: AgentStep[]) => {
        thoughtCache.set(thoughtText, res);
        trimCache(thoughtCache);
        resolve(res);
      },
      reject,
    });
    worker.postMessage({ id, type: 'parseThought', payload: thoughtText });
  });
}
