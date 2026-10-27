import * as cheerio from 'cheerio';
import type { TorrentResult } from '../../shared/types';
import {
  cleanAndDeduplicateVoices,
  detectContentType, extractDynamicRange, extractPart, extractResolution, extractSeason, extractStudios,
  formatBytes, isVideoRelease, parseSizeBytes, parseTopicHtml, relevanceFor, russianLanguageStatus, titleFromRelease
} from '../lib/metadata';
import { encodeWin1251, fetchPage, mapConcurrent, ProviderError, type ProviderSearchOptions, type TorrentProvider } from './provider';

const BASE_URL = 'https://nnmclub.to';

export class NnmClubProvider implements TorrentProvider {
  readonly id = 'nnmclub';
  readonly name = 'NNM';

  async search({ query, page, signal, customStudios, qualityAliases }: ProviderSearchOptions): Promise<TorrentResult[]> {
    const encoded = encodeWin1251(query);
    const html = await fetchPage(`${BASE_URL}/forum/tracker.php`, signal, {
      method: 'POST',
      encoding: 'win1251',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `f=-1&nm=${encoded}&search_submit=%C8%F1%EA%E0%F2%FC&start=${page * 50}`
    });
    const $ = cheerio.load(html);
    const results: TorrentResult[] = [];
    $('.forumline').eq(1).find('tbody tr').each((_, element) => {
      const row = $(element);
      const titleLink = row.find('.genmed a').filter((__, link) => Boolean($(link).find('b').text().trim())).first();
      const rawTitle = titleLink.find('b').text().trim();
      const href = titleLink.attr('href');
      if (!rawTitle || !href) return;
      if (!isVideoRelease(rawTitle)) return;
      const itemId = href.match(/[?&]t=(\d+)/u)?.[1];
      const small = row.find('.gensmall');
      const sizeIndex = small.length === 4 ? 1 : small.length === 5 ? 2 : 1;
      const sizeLabel = small.eq(sizeIndex).text().trim().split(' ', 3).slice(1).join(' ') || 'Не указано';
      const timestamp = Number(small.eq(sizeIndex + 2).text().trim().split(/\s+/u)[0]);
      const torrentHref = row.find('a[href*="download.php?id="]').first().attr('href');
      const { title, alternatives, year } = titleFromRelease(rawTitle);
      const studios = extractStudios(rawTitle, customStudios);
      const sizeBytes = parseSizeBytes(sizeLabel);
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
        sizeLabel: sizeBytes ? formatBytes(sizeBytes) : 'Не указано',
        seeds: positiveNumber(row.find('.seedmed').text()),
        leeches: positiveNumber(row.find('.leechmed').text()),
        publishedAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : undefined,
        pageUrl: new URL(href, `${BASE_URL}/forum/`).toString(),
        torrentUrl: torrentHref ? new URL(torrentHref, `${BASE_URL}/forum/`).toString() : undefined,
        relevance: relevanceFor(query, title, alternatives, rawTitle)
      });
    });

    return results;
  }

  async check(signal: AbortSignal = AbortSignal.timeout(12_000)): Promise<void> {
    await fetchPage(`${BASE_URL}/forum/tracker.php`, signal, {
      method: 'POST',
      encoding: 'win1251',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `f=-1&nm=test&search_submit=%C8%F1%EA%E0%F2%FC&start=0`
    });
  }
}

function positiveNumber(value: string): number | undefined {
  const result = Number(value.replace(/[^\d]/gu, ''));
  return Number.isFinite(result) && result > 0 ? result : undefined;
}
