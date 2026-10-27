import { describe, expect, it } from 'vitest';
import type { AppSettings, TorrentResult } from '../../shared/types';
import { SearchEngine } from './search-engine';
import type { TorrentProvider } from '../providers/provider';

const settings: AppSettings = { showUnconfirmedLanguage: true, customStudios: [], qualityAliases: [], providers: [{ id: 'good', name: 'Хороший', enabled: true }, { id: 'bad', name: 'Плохой', enabled: true }] };
const result = (id: string, providerId = 'good', seeds = 1): TorrentResult => ({ id, providerId, providerName: providerId, rawTitle: 'Тестовый фильм (2024) 1080p DUB', title: 'Тестовый фильм', alternativeTitles: [], year: 2024, contentType: 'movie', resolution: '1080p', dynamicRange: 'unknown', studios: [], languageStatus: 'confirmed', sizeLabel: 'Не указано', seeds, pageUrl: 'https://example.test', relevance: 1000 });

describe('поисковый движок', () => {
  it('объединяет результаты и сохраняет доступный источник при ошибке другого', async () => {
    const good: TorrentProvider = { id: 'good', name: 'Хороший', check: async () => {}, search: async () => [result('good:1'), result('good:2', 'good', 5), result('good:1')] };
    const bad: TorrentProvider = { id: 'bad', name: 'Плохой', check: async () => { throw new Error('timeout'); }, search: async () => { throw new Error('timeout'); } };
    const engine = new SearchEngine([good, bad], () => settings, () => {});
    const response = await engine.search({ requestId: 'request-1', query: 'тестовый фильм', exact: true, contentType: 'all' });
    expect(response.results).toHaveLength(2);
    expect(response.results.map((r) => r.id)).toEqual(['good:1', 'good:2']);
    expect(response.providerStates.find((item) => item.id === 'bad')?.status).toBe('error');
  });
  it('отменяет активный запрос и не возвращает поздние данные', async () => {
    const slow: TorrentProvider = { id: 'good', name: 'Хороший', check: async () => {}, search: ({ signal }) => new Promise<TorrentResult[]>((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); setTimeout(() => resolve([result('slow:1')]), 50); }) };
    const engine = new SearchEngine([slow], () => ({ ...settings, providers: [settings.providers[0]] }), () => {});
    const pending = engine.search({ requestId: 'cancel-me', query: 'тестовый фильм', exact: false, contentType: 'all' });
    engine.cancel('cancel-me');
    await expect(pending).resolves.toMatchObject({ cancelled: true, results: [] });
  });
  it('исключает из выдачи раздачи с 0 сидами', async () => {
    const provider: TorrentProvider = {
      id: 'good',
      name: 'Хороший',
      check: async () => {},
      search: async () => [result('good:1', 'good', 0), result('good:2', 'good', 3)]
    };
    const engine = new SearchEngine([provider], () => settings, () => {});
    const response = await engine.search({ requestId: 'req-seeds', query: 'тестовый фильм', exact: false, contentType: 'all' });
    expect(response.results).toHaveLength(1);
    expect(response.results[0].id).toBe('good:2');
  });
});
