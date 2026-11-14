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

export const DEFAULT_CLOUDFLARE_WORKER_URL = 'https://torrfilm-proxy.yuroc1206.workers.dev';
export const DEFAULT_BACKUP_WORKER_URL = 'https://acqjmtapqiscohnnejvq.supabase.co/functions/v1/torrfilmproxy';

export interface GatewayConfig {
  bypassBlocking?: boolean;
  cloudflareWorkerUrl?: string;
  backupWorkerUrl?: string;
}

let activeGatewayConfig: GatewayConfig = {
  bypassBlocking: false,
  cloudflareWorkerUrl: DEFAULT_CLOUDFLARE_WORKER_URL,
  backupWorkerUrl: DEFAULT_BACKUP_WORKER_URL
};

export function setGatewayConfig(config: Partial<GatewayConfig>): void {
  activeGatewayConfig = {
    ...activeGatewayConfig,
    ...config,
    cloudflareWorkerUrl: config.cloudflareWorkerUrl?.trim() || activeGatewayConfig.cloudflareWorkerUrl || DEFAULT_CLOUDFLARE_WORKER_URL,
    backupWorkerUrl: config.backupWorkerUrl?.trim() || activeGatewayConfig.backupWorkerUrl || DEFAULT_BACKUP_WORKER_URL
  };
}

export function getGatewayConfig(): GatewayConfig {
  return activeGatewayConfig;
}

export function isKnownBlockedTracker(targetUrl: string): boolean {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    return (
      host.includes('rutor') ||
      host.includes('nnmclub') ||
      host.includes('megapeer')
    );
  } catch {
    return false;
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchPageOptions {
  method?: string;
  body?: BodyInit;
  encoding?: 'utf8' | 'win1251';
  headers?: Record<string, string>;
  customFetch?: Fetcher;
}

export async function fetchViaGateway(
  workerUrl: string,
  targetUrl: string,
  options: FetchPageOptions,
  signal?: AbortSignal,
  timeoutMs = 6000
): Promise<string> {
  const cleanWorker = workerUrl.trim().replace(/\/+$/, '');
  const encoding = options.encoding ?? 'utf8';
  const proxyUrl = `${cleanWorker}/?url=${encodeURIComponent(targetUrl)}&encoding=${encoding}`;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let res = await (options.customFetch ?? fetch)(proxyUrl, {
    method: options.method ?? 'GET',
    headers: {
      'User-Agent': APP_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
      ...(options.headers ?? {})
    },
    body: options.body,
    signal: combined
  });

  if (!res.ok) {
    if (res.status === 404 && targetUrl.includes('megapeer')) {
      if (typeof res.text === 'function') {
        return await res.text();
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return iconv.decode(buf, 'win1251');
    }
    if ((res.status === 502 || res.status === 503 || res.status === 504) && !signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!signal?.aborted) {
        try {
          const retryRes = await (options.customFetch ?? fetch)(proxyUrl, {
            method: options.method ?? 'GET',
            headers: {
              'User-Agent': APP_USER_AGENT,
              'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
              ...(options.headers ?? {})
            },
            body: options.body,
            signal: combined
          });
          if (retryRes.ok) {
            res = retryRes;
          }
        } catch {
          // Keep original error
        }
      }
    }
    if (!res.ok) {
      throw new ProviderError(`Gateway HTTP ${res.status}`, `Шлюз вернул ошибку ${res.status}`);
    }
  }

  if (typeof res.text === 'function') {
    return await res.text();
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const asUtf8 = buf.toString('utf8');
  if (encoding === 'win1251' && asUtf8.includes('\ufffd')) {
    return iconv.decode(buf, 'win1251');
  }
  return asUtf8;
}

export async function fetchViaGatewayCascade(
  targetUrl: string,
  options: FetchPageOptions,
  signal?: AbortSignal
): Promise<string> {
  const config = getGatewayConfig();
  const workerUrl = config.cloudflareWorkerUrl?.trim() || DEFAULT_CLOUDFLARE_WORKER_URL;
  const backupUrl = config.backupWorkerUrl?.trim() || DEFAULT_BACKUP_WORKER_URL;

  // 1. Primary: Cloudflare Worker Gateway (5s timeout)
  if (workerUrl) {
    try {
      return await fetchViaGateway(workerUrl, targetUrl, options, signal, 5000);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  // 2. Backup: Supabase Edge Gateway (5s timeout)
  if (backupUrl && backupUrl !== workerUrl) {
    try {
      return await fetchViaGateway(backupUrl, targetUrl, options, signal, 5000);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  throw new ProviderError(
    'All gateways unavailable',
    'Шлюзы обхода блокировок недоступны. Проверьте подключение к сети.'
  );
}

export async function fetchPage(
  url: string,
  signal: AbortSignal,
  encodingOrOptions: 'utf8' | 'win1251' | FetchPageOptions = 'utf8',
  customHeaders?: Record<string, string>,
  customFetch?: Fetcher
): Promise<string> {
  const options: FetchPageOptions = typeof encodingOrOptions === 'string'
    ? { encoding: encodingOrOptions, headers: customHeaders, customFetch }
    : encodingOrOptions;

  const isBypassActive = Boolean(getGatewayConfig().bypassBlocking);

  // STRICT: If bypass is active and tracker is blocked in Russia (RuTor, NNMClub, MegaPeer),
  // requests MUST go ONLY through gateways. Never connect directly, even if gateways fail!
  if (isBypassActive && isKnownBlockedTracker(url) && !options.customFetch) {
    return await fetchViaGatewayCascade(url, options, signal);
  }

  const encoding = options.encoding ?? 'utf8';
  const fetchFn = options.customFetch ?? customFetch ?? fetch;
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

  if (!response.ok) {
    if (response.status === 404 && url.includes('megapeer')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return iconv.decode(buffer, 'win1251');
    }

    if ((response.status === 502 || response.status === 503 || response.status === 504) && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!signal.aborted) {
        try {
          const retryResponse = await fetchFn(url, {
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
          if (retryResponse.ok) {
            response = retryResponse;
          }
        } catch {
          // Keep original error
        }
      }
    }

    if (!response.ok) {
      throw new ProviderError(`HTTP ${response.status}`, `Источник вернул ошибку ${response.status}`);
    }
  }

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
