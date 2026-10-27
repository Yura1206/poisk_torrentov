import type { AppSettings, ProviderState, SearchRequest, SearchResponse, TorrentResult } from '../../shared/types';
import { exactTitleMatches, isVideoRelease, normaliseText, normalTitleMatches } from '../lib/metadata';
import { ProviderError, type TorrentProvider } from '../providers/provider';

export type SearchProgressCallback = (payload: {
  requestId: string;
  batch: TorrentResult[];
  providerState: ProviderState;
}) => void;

export class SearchEngine {
  private readonly active = new Map<string, AbortController>();
  constructor(private readonly providers: TorrentProvider[], private readonly settings: () => AppSettings, private readonly addHistory: (query: string) => void) {}

  async search(request: SearchRequest, onProgress?: SearchProgressCallback): Promise<SearchResponse> {
    this.cancel(request.requestId);
    const controller = new AbortController();
    this.active.set(request.requestId, controller);
    const saved = this.settings();
    const configured = this.providers.map((provider): { provider: TorrentProvider; state: ProviderState } => {
      const savedProvider = saved.providers.find((item) => item.id === provider.id);
      const enabled = savedProvider?.enabled ?? true;
      const reason = 'reason' in provider && typeof provider.reason === 'string' ? provider.reason : savedProvider?.note;
      return {
        provider,
        state: {
          id: provider.id,
          name: provider.name,
          enabled,
          status: enabled ? 'searching' : 'disabled',
          message: enabled ? undefined : reason,
          requiresAuth: savedProvider?.requiresAuth,
          authorized: savedProvider?.authorized
        }
      };
    });
    try {
      const work = configured.filter(({ state }) => state.enabled).map(async ({ provider, state }) => {
        try {
          const results = await provider.search({
            query: request.query,
            page: request.page ?? 0,
            signal: controller.signal,
            customStudios: saved.customStudios,
            qualityAliases: saved.qualityAliases,
            rutrackerAuth: saved.rutrackerAuth
          });
          state.status = 'ok';
          state.received = results.length;
          const matches = results.filter((item) => {
            if ((item.seeds ?? 0) < 1) return false;
            if (!isVideoRelease(item.rawTitle)) return false;
            const titleMatches = request.exact
              ? exactTitleMatches(request.query, item)
              : normalTitleMatches(request.query, item);
            return titleMatches && (request.contentType === 'all' || item.contentType === request.contentType);
          });
          if (!controller.signal.aborted) {
            onProgress?.({
              requestId: request.requestId,
              batch: matches,
              providerState: { ...state }
            });
          }
          return results;
        } catch (error) {
          if (controller.signal.aborted) throw error;
          state.status = 'error';
          state.message = error instanceof Error ? error.message : 'Неизвестная ошибка';
          if (!controller.signal.aborted) {
            onProgress?.({
              requestId: request.requestId,
              batch: [],
              providerState: { ...state }
            });
          }
          return [];
        }
      });
      const settled = await Promise.allSettled(work);
      if (controller.signal.aborted) return { requestId: request.requestId, results: [], providerStates: configured.map(({ state }) => state), cancelled: true };
      const all = settled.flatMap((item) => item.status === 'fulfilled' ? item.value : []);
      const matches = all.filter((item) => {
        if ((item.seeds ?? 0) < 1) return false;
        if (!isVideoRelease(item.rawTitle)) return false;
        const titleMatches = request.exact
          ? exactTitleMatches(request.query, item)
          : normalTitleMatches(request.query, item);
        return titleMatches && (request.contentType === 'all' || item.contentType === request.contentType);
      });
      if ((request.page ?? 0) === 0) this.addHistory(request.query);
      return { requestId: request.requestId, results: deduplicate(matches), providerStates: configured.map(({ state }) => state), hasMore: all.length > 0 };
    } finally {
      this.active.delete(request.requestId);
    }
  }

  cancel(requestId: string): void {
    this.active.get(requestId)?.abort();
    this.active.delete(requestId);
  }

  async check(): Promise<ProviderState[]> {
    return Promise.all(this.providers.map(async (provider) => {
      try {
        await provider.check();
        return { id: provider.id, name: provider.name, enabled: true, status: 'ok' as const };
      } catch (error) {
        const message = error instanceof ProviderError
          ? error.userMessage
          : (error instanceof Error ? error.message : 'Неизвестная ошибка');
        return { id: provider.id, name: provider.name, enabled: true, status: 'error' as const, message };
      }
    }));
  }
}

function deduplicate(results: TorrentResult[]): TorrentResult[] {
  const seen = new Set<string>();
  const unique: TorrentResult[] = [];
  for (const result of results) {
    const key = result.id || `${result.providerId}:${result.providerItemId ?? result.pageUrl}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(result);
    }
  }
  return unique;
}
