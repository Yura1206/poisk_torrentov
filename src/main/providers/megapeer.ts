import * as cheerio from 'cheerio';
import type { TorrentResult } from '../../shared/types';
import {
  cleanAndDeduplicateVoices,
  detectContentType, extractDynamicRange, extractPart, extractResolution, extractSeason, extractStudios,
  formatBytes, isVideoRelease, parseRussianDate, parseSizeBytes, parseTopicHtml, relevanceFor, russianLanguageStatus, titleFromRelease
} from '../lib/metadata';
import { encodeWin1251, fetchPage, mapConcurrent, type ProviderSearchOptions, type TorrentProvider } from './provider';

const BASE_URL = 'https://megapeer.vip';

export class MegapeerProvider implements TorrentProvider {
  readonly id = 'megapeer';
  readonly name = 'MegaPeer';

  async search({ query, page, signal, customStudios, qualityAliases }: ProviderSearchOptions): Promise<TorrentResult[]> {
    const encoded = encodeWin1251(query);
    const url = `${BASE_URL}/browse.php?search=${encoded}&page=${page}`;
    const html = await fetchPage(url, signal, 'win1251');
    const $ = cheerio.load(html);
    const results: TorrentResult[] = [];

    $('tr').has('a[href*="/torrent/"]').each((_, element) => {
      const row = $(element);
      const titleLink = row.find('a.url, a[href*="/torrent/"]').first();
      const rawTitle = titleLink.text().trim();
      const href = titleLink.attr('href');
      if (!rawTitle || !href) return;
      if (!isVideoRelease(rawTitle)) return;

      const itemId = href.match(/\/torrent\/(\d+)/u)?.[1];
      const downloadHref = row.find('a[href*="/download/"]').first().attr('href');
      const torrentUrl = downloadHref ? new URL(downloadHref, BASE_URL).toString() : undefined;
      const pageUrl = new URL(href, BASE_URL).toString();

      const cells = row.find('td');
      const dateText = cells.eq(0).text().replace(/\s+/g, ' ').trim();
      const publishedAt = parseRussianDate(dateText);

      // Size is usually in td with align="right" or index 2
      const sizeText = row.find('td[align="right"]').first().text().trim() || cells.eq(2).text().trim();
      const sizeBytes = parseSizeBytes(sizeText);

      // Seeders / leechers
      const seedText = row.find('img[src*="seed"]').parent().find('font').first().text().trim();
      const leechText = row.find('img[src*="leech"]').parent().find('font').last().text().trim();
      const seeds = positiveNumber(seedText);
      const leeches = positiveNumber(leechText);

      const { title, alternatives, year } = titleFromRelease(rawTitle);
      const studios = extractStudios(rawTitle, customStudios);

      results.push({
        id: `${this.id}:${itemId ?? href}`,
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
        sizeBytes,
        sizeLabel: sizeBytes ? formatBytes(sizeBytes) : sizeText || 'Не указано',
        seeds,
        leeches,
        publishedAt,
        pageUrl,
        torrentUrl,
        relevance: relevanceFor(query, title, alternatives, rawTitle)
      });
    });

    return results;
  }

  async check(signal: AbortSignal = AbortSignal.timeout(12_000)): Promise<void> {
    await fetchPage(`${BASE_URL}/browse.php?search=test`, signal, 'win1251');
  }
}

function positiveNumber(value: string): number | undefined {
  const result = Number(value.replace(/[^\d]/gu, ''));
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}
