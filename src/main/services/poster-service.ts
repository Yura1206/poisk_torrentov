import { APP_USER_AGENT } from '../providers/provider';

function cleanTitleForSearch(title: string): string {
  return title
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(s: string): string {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function titlesMatch(target: string, candidate: string, candidateOriginal?: string): boolean {
  const normTarget = normalizeTitle(target);
  const normCand = normalizeTitle(candidate);
  const normOrig = candidateOriginal ? normalizeTitle(candidateOriginal) : '';

  if (!normTarget || (!normCand && !normOrig)) return false;

  // Exact equality
  if (normTarget === normCand || (normOrig && normTarget === normOrig)) return true;

  const targetWords = target.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const candWords = candidate.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  if (targetWords.length === 0 || candWords.length === 0) return false;

  const allTargetInCand = targetWords.every((w) => candWords.some((cw) => cw.includes(w) || w.includes(cw)));
  const allCandInTarget = candWords.every((w) => targetWords.some((tw) => tw.includes(w) || w.includes(tw)));

  const diffWords1 = targetWords.filter((w) => !candWords.some((cw) => cw.includes(w) || w.includes(cw)));
  const diffWords2 = candWords.filter((cw) => !targetWords.some((w) => w.includes(cw) || cw.includes(w)));

  // If both have conflicting significant words (>3 chars), they are definitely different films/shows
  const hasConflictingWords = diffWords1.some((w) => w.length > 3) && diffWords2.some((w) => w.length > 3);
  if (hasConflictingWords) return false;

  return allTargetInCand || allCandInTarget;
}

export class PosterService {
  private cache = new Map<string, string | null>();
  private ruTrackerPageLoader?: (url: string, signal?: AbortSignal) => Promise<string>;

  setRuTrackerPageLoader(loader: (url: string, signal?: AbortSignal) => Promise<string>): void {
    this.ruTrackerPageLoader = loader;
  }

  async resolvePoster(title: string, year?: number, pageUrl?: string, contentType?: string): Promise<string | null> {
    const cleanTitle = cleanTitleForSearch(title);
    if (!cleanTitle && !pageUrl) return null;

    const cacheKey = `${pageUrl || cleanTitle.toLowerCase()}:${year ?? ''}:${contentType ?? ''}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    // 1. First priority: fast catalog search by title & year & contentType (instant 50-80ms CDN poster)
    if (cleanTitle) {
      try {
        const catalogPoster = await this.searchCatalog(cleanTitle, year, contentType);
        if (catalogPoster) {
          this.cache.set(cacheKey, catalogPoster);
          return catalogPoster;
        }
      } catch {
        // Fall back to release page
      }
    }

    // 2. Fast path for TorrentKino if not found in search: direct slug from pageUrl
    if (pageUrl && pageUrl.includes('torrentkino.org')) {
      const slugMatch = pageUrl.match(/\/films\/([^#?\/]+)/);
      if (slugMatch) {
        const url = `https://torrentkino.org/images/posters/${slugMatch[1]}.webp`;
        this.cache.set(cacheKey, url);
        return url;
      }
    }

    // 3. Fallback: extract poster directly from the torrent release page (for TV shows, rare items)
    if (pageUrl && pageUrl.startsWith('http')) {
      try {
        const pagePoster = await this.extractPosterFromPage(pageUrl);
        if (pagePoster) {
          this.cache.set(cacheKey, pagePoster);
          return pagePoster;
        }
      } catch {
        // Ignore
      }
    }

    this.cache.set(cacheKey, null);
    return null;
  }

  private async extractPosterFromPage(pageUrl: string): Promise<string | null> {
    // Fast path for TorrentKino: slug from url gives the exact poster immediately
    if (pageUrl.includes('torrentkino.org')) {
      const slugMatch = pageUrl.match(/\/films\/([^#?\/]+)/);
      if (slugMatch) {
        return `https://torrentkino.org/images/posters/${slugMatch[1]}.webp`;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let html = '';

    try {
      if (pageUrl.includes('rutracker.org') && this.ruTrackerPageLoader) {
        html = await this.ruTrackerPageLoader(pageUrl, controller.signal);
      } else {
        const res = await fetch(pageUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': APP_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
          }
        });
        if (!res.ok) return null;
        html = await res.text();
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }

    return this.extractPosterFromHtml(html, pageUrl);
  }

  private extractPosterFromHtml(html: string, pageUrl: string): string | null {
    if (!html) return null;

    // TorrentKino: images/posters
    if (pageUrl.includes('torrentkino')) {
      const posterMatch = html.match(/<img[^>]+src=['"]([^'"]*\/images\/posters\/[^'"]+)['"]/i);
      if (posterMatch) {
        const src = posterMatch[1];
        return src.startsWith('http') ? src : `https://torrentkino.org${src}`;
      }
      const slugMatch = pageUrl.match(/\/films\/([^#?\/]+)/);
      if (slugMatch) {
        return `https://torrentkino.org/images/posters/${slugMatch[1]}.webp`;
      }
    }

    // RuTracker: handles left, right, centered or unaligned posters in post_body (var or img)
    if (pageUrl.includes('rutracker')) {
      const postBodyMatch = html.match(/class=["'][^'"]*post_body[^'"]*["'][^>]*>([\s\S]*?)(?:<div[^>]+class=["'](?:post_foot|signatures)|$)/i);
      const content = postBodyMatch ? postBodyMatch[1] : html;

      // Match any <var ... class="...postImg..."> or <img ... class="...postImg...">
      const tagMatches = content.matchAll(/<(?:var|img)\b[^>]*\bclass=['"][^'"]*postImg[^'"]*['"][^>]*>/gi);
      for (const tag of tagMatches) {
        const fullTag = tag[0];
        const urlMatch = fullTag.match(/\b(?:title|src)=['"]([^'"]+)['"]/i);
        if (urlMatch && urlMatch[1].startsWith('http')) {
          const url = urlMatch[1];
          if (!/icon|button|counter|flag|avatar|smilies/i.test(url)) {
            return url;
          }
        }
      }

      // Fallback: any content image inside post_body
      const anyImg = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (anyImg && anyImg[1].startsWith('http') && !/avatar|flag|icon|smilies/i.test(anyImg[1])) {
        return anyImg[1];
      }
    }

    // MegaPeer: first image inside #descr
    if (pageUrl.includes('megapeer')) {
      const descrMatch = html.match(/id=["']descr["'][^>]*>([\s\S]*?)<\/td>/i);
      const content = descrMatch ? descrMatch[1] : html;
      const imgMatch = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (imgMatch && imgMatch[1].startsWith('http')) return imgMatch[1];
    }

    // RuTor: first image inside #details (excluding icons)
    if (pageUrl.includes('rutor')) {
      const detailsMatch = html.match(/id=["']details["'][^>]*>([\s\S]*?)<\/table>/i);
      const content = detailsMatch ? detailsMatch[1] : html;
      const imgMatch = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (imgMatch && !imgMatch[1].includes('s.rutor.info') && imgMatch[1].startsWith('http')) {
        return imgMatch[1];
      }
    }

    // NNMClub: handles var.postImg, img.postImg, og:image
    if (pageUrl.includes('nnmclub')) {
      const postBodyMatch = html.match(/class=["'][^'"]*postbody[^'"]*["'][^>]*>([\s\S]*?)(?:<div[^>]+class=["'](?:post_foot|signatures)|$)/i);
      const content = postBodyMatch ? postBodyMatch[1] : html;

      // 1. Match var.postImg or img.postImg
      const tagMatches = content.matchAll(/<(?:var|img)\b[^>]*\bclass=['"][^'"]*postImg[^'"]*['"][^>]*>/gi);
      for (const tag of tagMatches) {
        const fullTag = tag[0];
        const urlMatch = fullTag.match(/\b(?:title|src)=['"]([^'"]+)['"]/i);
        if (urlMatch && urlMatch[1].startsWith('http')) {
          const url = urlMatch[1];
          if (!/icon|button|counter|flag|avatar|smilies|rss|spacer|rating/i.test(url)) {
            return url;
          }
        }
      }

      // 2. Check og:image meta tag
      const ogMatch = html.match(/<meta[^>]+property=['"]og:image['"][^>]+content=['"]([^'"]+)['"]/i);
      if (ogMatch && ogMatch[1].startsWith('http') && !/logo|icon|rss/i.test(ogMatch[1])) {
        return ogMatch[1];
      }

      // 3. Fallback: first content image inside postbody
      const anyImg = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (anyImg && anyImg[1].startsWith('http') && !/avatar|flag|icon|smilies|rss|spacer/i.test(anyImg[1])) {
        return anyImg[1];
      }
    }

    // Generic fallback: search for first content image (ignoring logos, buttons, counters, ratings, rss, spacers)
    const allImages = [...html.matchAll(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/gi)];
    for (const m of allImages) {
      const src = m[1];
      if (/logo|icon|button|banner|rating|counter|smilies|avatars|tracker|download|rss|spacer|cub\d+|templates|flags|platinum|magnet/i.test(src)) continue;
      if (src.startsWith('http')) return src;
    }

    return null;
  }

  private async searchCatalog(cleanTitle: string, year?: number, contentType?: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const url = `https://torrentkino.org/api/search?q=${encodeURIComponent(cleanTitle)}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': APP_USER_AGENT
      }
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        originalTitle?: string;
        posterUrl?: string;
        year?: number;
        contentType?: string;
        type?: string;
        releaseYears?: Array<{ start?: number; end?: number | null } | number>;
      }>;
    };

    if (!Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }

    // Filter results strictly matching the requested title!
    const matchingTitleItems = data.results.filter((item) => {
      if (!item.posterUrl || !item.title) return false;
      return titlesMatch(cleanTitle, item.title, item.originalTitle);
    });

    if (matchingTitleItems.length === 0) {
      // NEVER show a poster from a completely different title!
      return null;
    }

    // Score candidates based on title match, contentType (movie vs series), and year
    const scored = matchingTitleItems.map((item) => {
      let score = 0;
      const normTarget = normalizeTitle(cleanTitle);
      if (normTarget && (normalizeTitle(item.title || '') === normTarget || (item.originalTitle && normalizeTitle(item.originalTitle) === normTarget))) {
        score += 40;
      }

      // ContentType matching (series vs movie)
      if (contentType) {
        const isTargetSeries = contentType === 'series' || contentType === 'reality';
        const candType = (item.contentType || item.type || '').toLowerCase();
        const isCandSeries = candType.includes('series') || candType.includes('show') || candType.includes('сериал');
        if (isTargetSeries === isCandSeries) {
          score += 50;
        } else {
          score -= 60;
        }
      }

      // Year matching
      if (year) {
        if (item.year === year) {
          score += 60; // Exact year
        } else if (Array.isArray(item.releaseYears)) {
          const inRange = item.releaseYears.some((ry) => {
            if (typeof ry === 'number') return ry === year;
            if (ry && typeof ry === 'object') {
              const start = ry.start ?? 0;
              const end = ry.end ?? new Date().getFullYear();
              return year >= start && year <= end;
            }
            return false;
          });
          if (inRange) {
            score += 55;
          } else if (item.year && Math.abs(item.year - year) <= 1) {
            score += 10;
          } else {
            score -= 70;
          }
        } else if (item.year && Math.abs(item.year - year) <= 1) {
          score += 10;
        } else if (item.year) {
          score -= 70;
        }
      }

      return { item, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score > 0 && best.item.posterUrl) {
      return best.item.posterUrl.startsWith('http')
        ? best.item.posterUrl
        : `https://torrentkino.org${best.item.posterUrl}`;
    }

    return null;
  }
}

export const posterService = new PosterService();
