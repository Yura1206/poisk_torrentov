import type { TorrentResult } from '../../shared/types';
import {
  extractDynamicRange,
  extractResolution,
  extractSeason,
  formatBytes,
  isVideoRelease,
  parseSizeBytes,
  relevanceFor,
  titleFromRelease
} from '../lib/metadata';
import { APP_USER_AGENT, fetchPage, mapConcurrent, ProviderError, type ProviderSearchOptions, type TorrentProvider } from './provider';

const BASE_URL = 'https://torrentkino.org';

interface SearchItem {
  kinopoiskId?: string;
  slug: string;
  title: string;
  originalTitle?: string;
  year?: number;
  contentType?: string;
  releaseYears?: Array<{ start?: number | null; end?: number | null }>;
}

interface SearchResponse {
  results?: SearchItem[];
}

interface RawTorrentItem {
  id: number;
  quality?: string;
  qualityLabel?: string;
  size?: string;
  seeds?: number;
  peers?: number;
  translation?: string;
  seasonStart?: number | null;
  seasonEnd?: number | null;
  episodeStart?: number | null;
  episodeEnd?: number | null;
  episodesTotal?: number | null;
  sortedStudios?: string[];
  torrentPath?: string;
}

export class TorrentKinoProvider implements TorrentProvider {
  readonly id = 'torrentkino';
  readonly name = 'TorrentKino';

  async check(signal?: AbortSignal): Promise<void> {
    try {
      const res = await fetch(`${BASE_URL}/api/search?q=test`, {
        signal: signal ?? AbortSignal.timeout(6000),
        headers: {
          'User-Agent': APP_USER_AGENT,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        throw new ProviderError(`TorrentKino вернул статус ${res.status}`, `Источник TorrentKino недоступен (HTTP ${res.status})`);
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        error instanceof Error ? error.message : 'Сетевая ошибка',
        'Источник TorrentKino недоступен'
      );
    }
  }

  async search({ query, page, signal, customStudios, qualityAliases }: ProviderSearchOptions): Promise<TorrentResult[]> {
    if (page > 0) return [];

    const encoded = encodeURIComponent(query.trim());
    let searchData: SearchResponse;
    try {
      const res = await fetch(`${BASE_URL}/api/search?q=${encoded}`, {
        signal,
        headers: {
          'User-Agent': APP_USER_AGENT,
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        throw new ProviderError(`HTTP ${res.status}`, `TorrentKino вернул ошибку HTTP ${res.status}`);
      }
      searchData = (await res.json()) as SearchResponse;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(error instanceof Error ? error.message : 'Сетевая ошибка', 'Не удалось выполнить поиск на TorrentKino');
    }

    const films = (searchData.results || []).slice(0, 5);
    if (!films.length) return [];

    const allReleases: TorrentResult[] = [];

    await mapConcurrent(films, 3, async (film) => {
      if (signal.aborted) return;
      try {
        const pageUrl = `${BASE_URL}/films/${film.slug}`;
        const html = await fetchPage(pageUrl, signal, 'utf8');

        const torrents: RawTorrentItem[] = [];
        const rscMatches = [...html.matchAll(/self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g)];

        for (const m of rscMatches) {
          const raw = m[1];
          if (!raw.includes('/api/torrents/')) continue;
          const unescaped = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          const objects = unescaped.match(/\{"id":\d+,[^{}]+,"torrentPath":"\/api\/torrents\/[^"]+"\}/g);
          if (objects) {
            for (const objStr of objects) {
              try {
                const item = JSON.parse(objStr) as RawTorrentItem;
                if (item.id && item.torrentPath) {
                  torrents.push(item);
                }
              } catch (_) {}
            }
          }
        }

        if (!torrents.length && html.includes('/api/torrents/')) {
          const unescaped = html.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          const objects = unescaped.match(/\{"id":\d+,[^{}]+,"torrentPath":"\/api\/torrents\/[^"]+"\}/g);
          if (objects) {
            for (const objStr of objects) {
              try {
                const item = JSON.parse(objStr) as RawTorrentItem;
                if (item.id && item.torrentPath) {
                  torrents.push(item);
                }
              } catch (_) {}
            }
          }
        }

        for (const t of torrents) {
          const rawTitle = [
            film.title,
            film.originalTitle ? `/ ${film.originalTitle}` : '',
            film.year ? `(${film.year})` : '',
            t.seasonStart ? `[Сезон ${t.seasonStart}${t.seasonEnd && t.seasonEnd !== t.seasonStart ? '-' + t.seasonEnd : ''}]` : '',
            t.qualityLabel || t.quality
          ].filter(Boolean).join(' ');

          if (!isVideoRelease(rawTitle)) continue;

          const parsedTitle = titleFromRelease(rawTitle);
          const title = parsedTitle.title;
          const alternatives = Array.from(new Set([...parsedTitle.alternatives, ...(film.originalTitle ? [film.originalTitle] : [])]));
          const sizeBytes = parseSizeBytes(t.size);
          const sizeLabel = sizeBytes ? formatBytes(sizeBytes) : (t.size || 'Не указан');
          const isSeries = film.contentType === 'tv-series' || film.contentType === 'mini-series' || t.seasonStart != null;
          const season = t.seasonStart ?? extractSeason(rawTitle);
          const resolution = extractResolution(t.qualityLabel || t.quality || '', qualityAliases);
          const dynamicRange = extractDynamicRange(t.qualityLabel || '');

          allReleases.push({
            id: `torrentkino:${film.slug}:${t.id}`,
            providerId: 'torrentkino',
            providerName: 'TorrentKino',
            providerItemId: String(t.id),
            rawTitle,
            title,
            alternativeTitles: film.originalTitle ? [film.originalTitle] : [],
            year: film.year,
            contentType: isSeries ? 'series' : 'movie',
            season,
            resolution,
            dynamicRange,
            studios: [],
            languageStatus: 'confirmed',
            sizeBytes,
            sizeLabel,
            seeds: t.seeds ?? 0,
            leeches: t.peers ?? 0,
            pageUrl: `${BASE_URL}/films/${film.slug}#torrent-${t.id}`,
            torrentUrl: `${BASE_URL}${t.torrentPath}`,
            relevance: relevanceFor(query, title, alternatives, rawTitle)
          });
        }
      } catch (_) {}
    });

    return allReleases;
  }
}
