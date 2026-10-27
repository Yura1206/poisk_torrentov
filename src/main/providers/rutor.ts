import * as cheerio from 'cheerio';
import type { TorrentResult } from '../../shared/types';
import {
  cleanAndDeduplicateVoices,
  detectContentType, extractDynamicRange, extractPart, extractResolution, extractSeason, extractStudios,
  formatBytes, isVideoRelease, parseRussianDate, parseSizeBytes, parseTopicHtml, relevanceFor, russianLanguageStatus, titleFromRelease
} from '../lib/metadata';
import { fetchPage, mapConcurrent, ProviderError, type ProviderSearchOptions, type TorrentProvider } from './provider';

const BASE_URLS = ['https://rutor.info', 'https://rutor.is'];

export class RutorProvider implements TorrentProvider {
  readonly id = 'rutor';
  readonly name = 'RuTor';

  async search({ query, page, signal, customStudios, qualityAliases }: ProviderSearchOptions): Promise<TorrentResult[]> {
    let html: string | undefined;
    let baseUrl = BASE_URLS[0];
    let lastError: unknown;
    for (const candidate of BASE_URLS) {
      try {
        html = await fetchPage(`${candidate}/search/${page}/0/300/0/${encodeURIComponent(query)}`, signal);
        baseUrl = candidate;
        break;
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    if (!html) throw lastError instanceof ProviderError ? lastError : new ProviderError('No RuTor endpoint available', 'RuTor временно недоступен');
    const $ = cheerio.load(html);
    const results: TorrentResult[] = [];
    $('table').eq(2).find('tbody tr').each((_, element) => {
      const row = $(element);
      const releaseLink = row.find('a[href^="/torrent/"]').first();
      const href = releaseLink.attr('href');
      const rawTitle = releaseLink.text().trim();
      if (!href || !rawTitle) return;
      if (row.find('a[href^="/audio"], a[href^="/games"], a[href^="/soft"], a[href^="/books"]').length > 0) return;
      if (!isVideoRelease(rawTitle)) return;
      const cells = row.find('td');
      const sizeIndex = cells.length === 5 ? 3 : cells.length === 4 ? 2 : -1;
      const sizeLabel = sizeIndex >= 0 ? cells.eq(sizeIndex).text().replace(/\s+/g, ' ').trim() : 'Не указано';
      const pageUrl = new URL(href, baseUrl).toString();
      const itemId = href.match(/\/torrent\/(\d+)/u)?.[1];
      const magnet = row.find('a[href^="magnet:"]').first().attr('href');
      const downloadHref = row.find('a.downgif, a[href*="/download/"]').first().attr('href');
      const torrentUrl = downloadHref ? new URL(downloadHref, baseUrl).toString() : undefined;
      const { title, alternatives, year } = titleFromRelease(rawTitle);
      const studios = extractStudios(rawTitle, customStudios);
      const seeds = numberOrUndefined(row.find('.green').first().text());
      const leeches = numberOrUndefined(row.find('.red').first().text());
      const publishedAt = parseRussianDate(cells.eq(0).text().replace(/\s+/g, ' ').trim());
      results.push({
        id: `${this.id}:${itemId ?? pageUrl}`,
        providerId: this.id,
        providerName: this.name,
        providerItemId: itemId,
        rawTitle,
        title,
        alternativeTitles: alternatives,
        year,
        contentType: detectContentType(rawTitle),
        season: extractSeason(rawTitle),
        part: extractPart(rawTitle),
        resolution: extractResolution(rawTitle, qualityAliases),
        dynamicRange: extractDynamicRange(rawTitle),
        studios,
        languageStatus: russianLanguageStatus(rawTitle, studios),
        sizeBytes: parseSizeBytes(sizeLabel),
        sizeLabel: parseSizeBytes(sizeLabel) ? formatBytes(parseSizeBytes(sizeLabel)) : 'Не указано',
        seeds,
        leeches,
        publishedAt,
        pageUrl,
        torrentUrl,
        magnetUrl: validMagnet(magnet) ? magnet : undefined,
        relevance: relevanceFor(query, title, alternatives, rawTitle)
      });
    });

    return results;
  }

  async check(signal: AbortSignal = AbortSignal.timeout(12_000)): Promise<void> {
    await fetchPage(`${BASE_URLS[0]}/search/`, signal);
  }
}

function numberOrUndefined(value: string): number | undefined {
  const number = Number(value.replace(/[^\d]/gu, ''));
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function validMagnet(value?: string): value is string {
  return Boolean(value && /^magnet:\?xt=urn:btih:[a-z0-9]{32,64}/iu.test(value));
}
