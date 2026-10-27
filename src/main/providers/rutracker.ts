import * as cheerio from 'cheerio';
import type { RuTrackerAuth, TorrentResult } from '../../shared/types';
import {
  detectContentType, extractDynamicRange, extractPart, extractResolution, extractSeason, extractStudios,
  formatBytes, isVideoRelease, parseRussianDate, parseSizeBytes, relevanceFor, russianLanguageStatus, titleFromRelease
} from '../lib/metadata';
import { encodeWin1251, type Fetcher, fetchPage, ProviderError, type ProviderSearchOptions, type TorrentProvider } from './provider';

const BASE_URL = 'https://rutracker.org';

export class RutrackerProvider implements TorrentProvider {
  readonly id = 'rutracker';
  readonly name = 'RuTracker';

  constructor(
    private readonly getAuth: () => RuTrackerAuth | undefined,
    private readonly customFetch?: () => Fetcher,
    private readonly pageLoader?: (url: string, signal?: AbortSignal) => Promise<string>
  ) {}

  async search({ query, page, signal, customStudios, qualityAliases, rutrackerAuth }: ProviderSearchOptions): Promise<TorrentResult[]> {
    const auth = rutrackerAuth ?? this.getAuth();
    if (!auth?.authorized) {
      throw new ProviderError(
        'RuTracker requires authorization',
        'RuTracker требует авторизации. Откройте настройки и выполните вход в аккаунт.'
      );
    }

    const encoded = encodeWin1251(query);
    const url = `${BASE_URL}/forum/tracker.php?nm=${encoded}&o=10&s=2&start=${page * 50}`;

    let html: string;
    if (this.pageLoader) {
      html = await this.pageLoader(url, signal);
    } else {
      const headers: Record<string, string> = {};
      if (auth.cookie) {
        headers.Cookie = auth.cookie;
      }
      const fetcher = this.customFetch?.() ?? fetch;
      html = await fetchPage(url, signal, 'win1251', headers, fetcher);
    }

    if (html.includes('Just a moment...') || html.includes('Один момент…') || html.includes('challenge-running')) {
      throw new ProviderError(
        'RuTracker Cloudflare verification required',
        'RuTracker требует подтверждения Cloudflare («Один момент...»). Откройте настройки и выполните повторный вход.'
      );
    }

    if ((html.includes('login.php') || html.includes('login_username')) && !html.includes('tor-tbl')) {
      throw new ProviderError(
        'RuTracker session expired',
        'Сессия RuTracker не авторизована или устарела. Пожалуйста, выполните повторный вход в настройках.'
      );
    }

    const $ = cheerio.load(html);
    const results: TorrentResult[] = [];

    $('#tor-tbl tbody tr.tCenter, .forumline tbody tr.tCenter').each((_, element) => {
      const row = $(element);
      const titleLink = row.find('a.tt-text, a.genmed b a, a[href*="viewtopic.php?t="]').first();
      const rawTitle = titleLink.text().trim();
      const href = titleLink.attr('href');
      if (!rawTitle || !href) return;

      const forumName = row.find('td.f-name a, td.f-name').text().trim();
      if (!isVideoRelease(rawTitle, forumName)) return;

      const topicId = href.match(/[?&]t=(\d+)/u)?.[1] || titleLink.attr('data-topic_id');
      const pageUrl = new URL(href, `${BASE_URL}/forum/`).toString();
      const torrentUrl = topicId ? `${BASE_URL}/forum/dl.php?t=${topicId}` : undefined;

      // Size
      const sizeCell = row.find('td.tor-size');
      const sizeBytesAttr = Number(sizeCell.attr('data-ts_text'));
      const sizeText = sizeCell.text().replace(/\s+/g, ' ').trim();
      const sizeBytes = Number.isFinite(sizeBytesAttr) && sizeBytesAttr > 0 ? sizeBytesAttr : parseSizeBytes(sizeText);

      // Seeders & Leechers
      const seedText = row.find('td.seedmed b, .seedmed b, .seedmed').first().text();
      const leechText = row.find('td.leechmed, .leechmed').first().text();
      const seeds = positiveNumber(seedText);
      const leeches = positiveNumber(leechText);

      // Date
      const dateCell = row.find('td[data-ts_text]').last();
      const timestamp = Number(dateCell.attr('data-ts_text'));
      const publishedAt = Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1000).toISOString()
        : parseRussianDate(dateCell.text().trim());

      const { title, alternatives, year } = titleFromRelease(rawTitle);
      const studios = extractStudios(rawTitle, customStudios);

      results.push({
        id: `${this.id}:${topicId ?? href}`,
        providerId: this.id,
        providerName: this.name,
        providerItemId: topicId,
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
    const auth = this.getAuth();
    if (!auth?.authorized) {
      throw new ProviderError(
        'RuTracker not authorized',
        'Требуется авторизация (нажмите «Авторизация» в настройках)'
      );
    }
    let html: string;
    const testUrl = `${BASE_URL}/forum/tracker.php`;
    if (this.pageLoader) {
      html = await this.pageLoader(testUrl, signal);
    } else {
      const headers: Record<string, string> = {};
      if (auth.cookie) headers.Cookie = auth.cookie;
      const fetcher = this.customFetch?.() ?? fetch;
      html = await fetchPage(testUrl, signal, 'win1251', headers, fetcher);
    }
    if (html.includes('Just a moment...') || html.includes('Один момент…') || html.includes('challenge-running')) {
      throw new ProviderError(
        'RuTracker Cloudflare verification required',
        'RuTracker требует подтверждения Cloudflare («Один момент...»). Выполните повторный вход в настройках.'
      );
    }
    if ((html.includes('login_username') || html.includes('login.php')) && !html.includes('tor-tbl')) {
      throw new ProviderError(
        'RuTracker session invalid',
        'Сессия RuTracker недействительна или устарела. Пожалуйста, выполните повторный вход в настройках.'
      );
    }
  }
}

function positiveNumber(value: string): number | undefined {
  const result = Number(value.replace(/[^\d]/gu, ''));
  return Number.isFinite(result) && result >= 0 ? result : undefined;
}
