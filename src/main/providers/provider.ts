import iconv from 'iconv-lite';
import type { Resolution, RuTrackerAuth, TorrentResult } from '../../shared/types';

export interface ProviderSearchOptions {
  query: string;
  page: number;
  signal: AbortSignal;
  customStudios: string[];
  qualityAliases: Array<{ term: string; resolution: Exclude<Resolution, 'unknown'> }>;
  rutrackerAuth?: RuTrackerAuth;
}

export interface TorrentProvider {
  id: string;
  name: string;
  search(options: ProviderSearchOptions): Promise<TorrentResult[]>;
  check(signal?: AbortSignal): Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
  }
}

export function encodeWin1251(text: string): string {
  const buf = iconv.encode(text, 'win1251');
  let hex = '';
  for (const b of buf) {
    if (
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b === 0x2d || b === 0x5f || b === 0x2e || b === 0x7e
    ) {
      hex += String.fromCharCode(b);
    } else {
      hex += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return hex;
}

export const APP_USER_AGENT =
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome || '138.0.0.0'} Safari/537.36`;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchPageOptions {
  method?: string;
  body?: BodyInit;
  encoding?: 'utf8' | 'win1251';
  headers?: Record<string, string>;
  customFetch?: Fetcher;
}

export async function fetchPage(
  url: string,
  signal: AbortSignal,
  encodingOrOptions: 'utf8' | 'win1251' | FetchPageOptions = 'utf8',
  customHeaders?: Record<string, string>,
  customFetch: Fetcher = fetch
): Promise<string> {
  const options: FetchPageOptions = typeof encodingOrOptions === 'string'
    ? { encoding: encodingOrOptions, headers: customHeaders, customFetch }
    : encodingOrOptions;

  const encoding = options.encoding ?? 'utf8';
  const fetchFn = options.customFetch ?? customFetch;
  const timeout = AbortSignal.timeout(15_000);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: options.method ?? 'GET',
      body: options.body,
      signal: combined,
      headers: {
        'User-Agent': APP_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        ...options.headers,
        ...(typeof encodingOrOptions === 'string' ? customHeaders : undefined)
      },
      redirect: 'follow'
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ProviderError(error instanceof Error ? error.message : 'Network request failed', 'Источник не отвечает или недоступен');
  }
  if (!response.ok) throw new ProviderError(`HTTP ${response.status}`, `Источник вернул ошибку ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (encoding === 'win1251') {
    return iconv.decode(buffer, 'win1251');
  }
  return buffer.toString('utf8');
}

export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
