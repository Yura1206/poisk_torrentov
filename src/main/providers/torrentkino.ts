import type { TorrentResult } from '../../shared/types';
import {
  correlateSeasonAndYear,
  extractDnFromMagnet,
  extractDynamicRange,
  extractResolution,
  extractSeason,
  extractSeasons,
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

        // Fetch /api/sources/{id} for seeded torrents (fast pure JSON) so dynamic range and magnet are 100% accurate
        const sourceMap = new Map<number, { video?: string; magnetUrl?: string }>();
        const relevantTorrents = torrents.filter((t) => (t.seeds ?? 0) >= 1);
        const toFetchSources = relevantTorrents.length > 0 ? relevantTorrents.slice(0, 12) : torrents.slice(0, 6);

        if (toFetchSources.length > 0) {
          await mapConcurrent(toFetchSources, 6, async (t) => {
            try {
              const sourceUrl = `${BASE_URL}/api/sources/${t.id}`;
              const sourceText = await fetchPage(sourceUrl, AbortSignal.timeout(4000), {
                headers: { Accept: 'application/json' }
              });
              const sourceObj = JSON.parse(sourceText) as { video?: string; magnetUrl?: string };
              if (sourceObj) {
                sourceMap.set(t.id, {
                  video: sourceObj.video || '',
                  magnetUrl: sourceObj.magnetUrl || ''
                });
              }
            } catch (_) {}
          });
        }

        const filmYears: number[] = [];
        if (Array.isArray(film.releaseYears)) {
          for (const ry of film.releaseYears) {
            if (ry && typeof ry === 'object') {
              if (ry.start) filmYears.push(ry.start);
              if (ry.end && ry.end !== ry.start) filmYears.push(ry.end);
            }
          }
        }
        if (!filmYears.length && film.year) filmYears.push(film.year);

        for (const t of torrents) {
          const sourceDetails = sourceMap.get(t.id);
          const videoText = sourceDetails?.video || '';
          const dnName = extractDnFromMagnet(sourceDetails?.magnetUrl);
          const qualityParts = [t.quality, t.qualityLabel].filter(Boolean).join(' ');
          const defaultRawTitle = [
            film.title,
            film.originalTitle ? `/ ${film.originalTitle}` : '',
            film.year ? `(${film.year})` : '',
            t.seasonStart ? `[Сезон ${t.seasonStart}${t.seasonEnd && t.seasonEnd !== t.seasonStart ? '-' + t.seasonEnd : ''}]` : '',
            qualityParts
          ].filter(Boolean).join(' ');
          const rawTitle = dnName || defaultRawTitle;

          if (!isVideoRelease(rawTitle) && !isVideoRelease(defaultRawTitle)) continue;

          const parsedTitle = titleFromRelease(defaultRawTitle);
          const title = parsedTitle.title;
          const alternatives = Array.from(new Set([...parsedTitle.alternatives, ...(film.originalTitle ? [film.originalTitle] : [])]));
          const sizeBytes = parseSizeBytes(t.size);
          const sizeLabel = sizeBytes ? formatBytes(sizeBytes) : (t.size || 'Не указан');
          const isSeries = film.contentType === 'tv-series' || film.contentType === 'mini-series' || t.seasonStart != null;
          const season = t.seasonStart ?? extractSeason(rawTitle) ?? extractSeason(defaultRawTitle);
          const seasons = (t.seasonStart != null && t.seasonEnd != null && t.seasonEnd >= t.seasonStart)
            ? Array.from({ length: t.seasonEnd - t.seasonStart + 1 }, (_, i) => (t.seasonStart as number) + i)
            : (extractSeasons(rawTitle).length ? extractSeasons(rawTitle) : extractSeasons(defaultRawTitle));

          const techString = [dnName, videoText, t.qualityLabel, t.quality, rawTitle, defaultRawTitle].filter(Boolean).join(' ');
          let resolution = extractResolution(techString, qualityAliases);
          if (resolution === 'unknown' && t.quality) {
            const q = t.quality.toLowerCase();
            if (q === '4k' || q === 'uhd') resolution = '2160p';
            else if (q === '1080p') resolution = '1080p';
            else if (q === '720p') resolution = '720p';
            else if (q === '480p') resolution = '480p';
            else if (q === '576p') resolution = '576p';
          }
          const dynamicRange = extractDynamicRange(techString);

          const yearsList = parsedTitle.years?.length ? parsedTitle.years : (filmYears.length ? filmYears : (film.year ? [film.year] : []));
          const correlated = correlateSeasonAndYear({
            contentType: isSeries ? 'series' : 'movie',
            season,
            seasons,
            year: film.year || parsedTitle.year,
            years: yearsList
          });

          allReleases.push({
            id: `torrentkino:${film.slug}:${t.id}`,
            providerId: 'torrentkino',
            providerName: 'TorrentKino',
            providerItemId: String(t.id),
            rawTitle,
            title,
            alternativeTitles: film.originalTitle ? [film.originalTitle] : [],
            year: correlated.year,
            years: correlated.years,
            contentType: isSeries ? 'series' : 'movie',
            season: correlated.season,
            seasons: correlated.seasons,
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
            magnetUrl: sourceDetails?.magnetUrl,
            relevance: relevanceFor(query, title, alternatives, rawTitle)
          });
        }
      } catch (_) {}
    });

    return allReleases;
  }
}
