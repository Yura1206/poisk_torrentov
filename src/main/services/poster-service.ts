import { APP_USER_AGENT, fetchPage } from '../providers/provider';
import { FilmRatings } from '../../shared/types';

const RU_TO_EN_MAP: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

function transliterateRuToEn(str: string): string {
  return (str || '')
    .toLowerCase()
    .split('')
    .map((c) => (RU_TO_EN_MAP[c] !== undefined ? RU_TO_EN_MAP[c] : c))
    .join('');
}

function cleanTitleForSearch(title: string): string {
  let t = title || '';
  // 1. Strip trailing seasons/episodes/releases after delimiters (. / - : |)
  // E.g. "Звёзды в джунглях. Карибский сезон 3" -> "Звёзды в джунглях"
  // E.g. "Слово пацана. Кровь на асфальте / 1 сезон" -> "Слово пацана. Кровь на асфальте"
  t = t.replace(/[.\-_:/|]\s*[^.\-_:/|]*(?:сезон(?:ы|а)?|season(?:s)?|выпуск(?:и|ов)?|сери(?:и|я|й)).*$/iu, '');

  // 2. Strip season subtitle markers without delimiters, e.g. "Карибский сезон", "Финальный сезон 2"
  t = t.replace(/\b(?:карибский|новогодний|финальный|новый)?\s*\d*\s*(?:сезон(?:ы|а)?|season(?:s)?)(?:\s*\d+)?\b.*$/iu, '');

  // 3. Remove parentheses and bracket contents
  t = t.replace(/[\(\[\{].*?[\)\]\}]/g, ' ');

  // 4. Remove punctuation
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');

  return t.replace(/\s+/g, ' ').trim();
}

function normalizeTitle(s: string): string {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

const TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

const TITLE_SEARCH_ALIASES: Record<string, string[]> = {
  'comedy club': ['камеди клаб'],
  'камеди клаб': ['comedy club'],
  'comedy баттл': ['камеди баттл', 'comedy battle'],
  'comedy battle': ['камеди баттл', 'comedy баттл'],
  'comedy woman': ['камеди вумен'],
  'камеди вумен': ['comedy woman'],
  'stand up': ['стендап'],
  'стендап': ['stand up'],
  'женский stand up': ['женский стендап'],
  'женский стендап': ['женский stand up'],
  'что было дальше': ['чбд'],
  'чбд': ['что было дальше']
};

const KNOWN_TITLE_POSTERS: Record<string, string> = {
  'камеди клаб': 'https://image.tmdb.org/t/p/w500/tPIbd7JZVxSWNjcJQYEvPu3qo5z.jpg',
  'comedy club': 'https://image.tmdb.org/t/p/w500/tPIbd7JZVxSWNjcJQYEvPu3qo5z.jpg',
  'битва экстрасенсов': 'https://image.tmdb.org/t/p/w500/yyuXEH1OP2QtwJFOm2wIMsEc03B.jpg',
  'новая битва экстрасенсов': 'https://image.tmdb.org/t/p/w500/krfOtowO5jsrcZnsT8mGxiBpGyH.jpg',
  'звезды в джунглях': 'https://m.media-amazon.com/images/M/MV5BMDdlM2FhOTctYzJhOS00MWRlLWI4M2MtZDljNzI3ZjNlNDA4XkEyXkFqcGc@._V1_QL75_UX380_.jpg',
  'звёзды в джунглях': 'https://m.media-amazon.com/images/M/MV5BMDdlM2FhOTctYzJhOS00MWRlLWI4M2MtZDljNzI3ZjNlNDA4XkEyXkFqcGc@._V1_QL75_UX380_.jpg',
  'звезды в африке': 'https://image.tmdb.org/t/p/w500/1TMCGy8l6C4XdSvcVDaN3hfMmGs.jpg',
  'звёзды в африке': 'https://image.tmdb.org/t/p/w500/1TMCGy8l6C4XdSvcVDaN3hfMmGs.jpg',
  'однажды в россии': 'https://image.tmdb.org/t/p/w500/A57leDI80aTVDudNMj70WZ7pPGD.jpg',
  'уральские пельмени': 'https://image.tmdb.org/t/p/w500/4kcPDFsBItXJMc44ODV79N1dfZO.jpg',
  'женский стендап': 'https://image.tmdb.org/t/p/w500/xWRuqeS53IkNGztZri3hcUgMQ5S.jpg',
  'квн': 'https://image.tmdb.org/t/p/w500/5DtKLe8ZTSZfuav8DyedJrZDmIF.jpg',
  'высшая лига квн': 'https://image.tmdb.org/t/p/w500/5DtKLe8ZTSZfuav8DyedJrZDmIF.jpg',
  'шоу воли': 'https://image.tmdb.org/t/p/w500/oWcnKSpnYFfCpqItJSUK0oOJFmk.jpg',
  'импровизация': 'https://image.tmdb.org/t/p/w500/pzk3vvV9uO5JkNXAvlKsE0uuXID.jpg',
  'импровизаторы': 'https://image.tmdb.org/t/p/w500/eOPV6kYaEmmUSodummut6bSxBWm.jpg'
};

const KNOWN_KINOPOISK_IDS: Record<string, string> = {
  'камеди клаб': '400612',
  'камедиклаб': '400612',
  'comedy club': '400612',
  'comedyclub': '400612',
  'сашатаня': '630232',
  'саша таня': '630232',
  'битва экстрасенсов': '74218',
  'битваэкстрасенсов': '74218',
  'новая битва экстрасенсов': '5064614',
  'экстрасенсы битва сильнейших': '5261173',
  'звезды в джунглях': '14171220',
  'звёзды в джунглях': '14171220',
  'звезды в африке': '1444158',
  'звёзды в африке': '1444158',
  'однажды в россии': '843343',
  'уральские пельмени': '632863',
  'женский стендап': '1341113',
  'квн': '409477',
  'высшая лига квн': '409477',
  'шоу воли': '5280765',
  'импровизация': '958564',
  'импровизаторы': '5258957',
  'comedy woman': '468160',
  'камеди вумен': '468160',
  'comedy баттл': '522434',
  'stand up': '778311',
  'стендап': '778311',
  'что было дальше': '1314643',
  'чбд': '1314643',
  'универ': '420848',
  'универ новая общага': '631245',
  'универ 10 лет спустя': '1406622',
  'универ 13 лет спустя': '5434771',
  'интерны': '505781',
  'папины дочки': '409295',
  'папины дочки новые': '5235882',
  'реальные пацаны': '526541',
  'физрук': '764491',
  'полицейский с рублевки': '843803',
  'жуки': '1112443',
  'счастливы вместе': '277490',
  'кухня': '683416',
  'отель элеон': '972846',
  'гранд': '1115320',
  'ивановы ивановы': '1047712'
};

export function titlesMatch(target: string, candidate: string, candidateOriginal?: string): boolean {
  const normTarget = normalizeTitle(target);
  const normCand = normalizeTitle(candidate);
  const normOrig = candidateOriginal ? normalizeTitle(candidateOriginal) : '';

  if (!normTarget || (!normCand && !normOrig)) return false;

  // Exact equality
  if (normTarget === normCand || (normOrig && normTarget === normOrig)) return true;

  // Check aliases (e.g. Comedy Club <-> Камеди Клаб)
  for (const [key, aliases] of Object.entries(TITLE_SEARCH_ALIASES)) {
    if (normTarget === normalizeTitle(key)) {
      for (const al of aliases) {
        const normAl = normalizeTitle(al);
        if (normCand === normAl || (normOrig && normOrig === normAl)) return true;
      }
    }
  }

  // Transliteration match (e.g. Russian "Звёзды в джунглях" vs IMDb "Zvyozdy v Dzhunglyakh")
  const translitTarget = normalizeTitle(transliterateRuToEn(target));
  if (translitTarget && (translitTarget === normCand || translitTarget === normOrig)) return true;

  // Prefix matching for transliteration or titles (handles subtitle differences like "Zvyozdy v Dzhunglyakh")
  if (translitTarget && translitTarget.length >= 6 && normCand.length >= 6) {
    if (translitTarget.startsWith(normCand) || normCand.startsWith(translitTarget)) return true;
  }
  if (translitTarget && normOrig && translitTarget.length >= 6 && normOrig.length >= 6) {
    if (translitTarget.startsWith(normOrig) || normOrig.startsWith(translitTarget)) return true;
  }
  if (normTarget.length >= 6 && normCand.length >= 6) {
    if (normTarget.startsWith(normCand) || normCand.startsWith(normTarget)) return true;
  }

  const targetWords = target.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const candWords = candidate.toLowerCase().split(/\s+/).filter((w) => w.length > 1);

  if (targetWords.length === 0 || candWords.length === 0) return false;

  const allTargetInCand = targetWords.every((w) => candWords.some((cw) => cw.includes(w) || w.includes(cw)));
  const allCandInTarget = candWords.every((w) => targetWords.some((tw) => tw.includes(w) || w.includes(tw)));

  const diffWords1 = targetWords.filter((w) => !candWords.some((cw) => cw.includes(w) || w.includes(cw)));
  const diffWords2 = candWords.filter((cw) => !targetWords.some((w) => w.includes(cw) || cw.includes(w)));

  // If candidate has significant extra words (>3 chars) that don't exist in target, it is a different film/spin-off!
  // E.g. Target: "Comedy Club" vs Candidate: "Palestine Comedy Club" -> 'palestine' is extra!
  const stopWords = new Set(['сериал', 'фильм', 'movie', 'series', 'show', 'шоу', 'part', 'часть', 'season', 'сезон']);
  const significantExtraInCand = diffWords2.filter((w) => w.length > 3 && !stopWords.has(w));
  if (significantExtraInCand.length > 0) return false;

  // If both have conflicting significant words (>3 chars), they are definitely different films/shows
  const hasConflictingWords = diffWords1.some((w) => w.length > 3) && diffWords2.some((w) => w.length > 3);
  if (hasConflictingWords) return false;

  return allTargetInCand || allCandInTarget;
}

function isDeadOrBlockedImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return true;
  return /nnmstatic\.win|radikal\.ru|radikal\.host|s\d*\.radikal|d\d*\.radikal|b\d*\.radikal|c\d*\.radikal|fastpic\.ru\/thumb\//i.test(url);
}

function unwrapImageUrl(url: string): string {
  if (!url) return '';
  const linkMatch = url.match(/image\.php\?link=([^&]+)/i);
  if (linkMatch) {
    try {
      const decoded = decodeURIComponent(linkMatch[1]);
      if (decoded.startsWith('http')) return decoded;
    } catch {}
  }
  return url;
}

export function isBadgeOrRatingImageUrl(url: string, tagHtml?: string): boolean {
  if (!url || typeof url !== 'string') return true;
  const combined = `${url} ${tagHtml || ''}`.toLowerCase();

  // Age ratings & restrictions: 0+, 6+, 12+, 16+, 18+, PG-13, R-rated, NC-17, etc.
  if (/(?:^|[\W_])(?:0|6|12|16|18)\s*(?:\+|plus|let|лет|years)(?:[\W_]|$)/i.test(combined)) {
    return true;
  }
  if (/(?:age[_\-]?rating|vozrast|pg[_\-]?13|mpaa|restriction|censorship)/i.test(combined)) {
    return true;
  }
  // Badges, icons, buttons, counters, flags, avatars, smilies, spacers, audio/sub logos
  if (/(?:icon|badge|button|counter|flag|avatar|smilies|spacer|banner_small|pixel|rating|subtitles)/i.test(combined)) {
    return true;
  }
  return false;
}

export class PosterService {
  private cache = new Map<string, string | null>();
  private titlePosterCache = new Map<string, string | null>();
  private catalogCache = new Map<string, string | null>();
  private catalogPromises = new Map<string, Promise<string | null>>();
  private posterPromises = new Map<string, Promise<string | null>>();
  private ratingsCache = new Map<string, FilmRatings | null>();
  private ratingsPromises = new Map<string, Promise<FilmRatings | null>>();
  private ruTrackerPageLoader?: (url: string, signal?: AbortSignal) => Promise<string>;
  private kpIdByTitle = new Map<string, string>();
  private knownKpIds = new Map<string, string>([
    ['звёзды в джунглях', '14171220']
  ]);

  setRuTrackerPageLoader(loader: (url: string, signal?: AbortSignal) => Promise<string>): void {
    this.ruTrackerPageLoader = loader;
  }

  async resolveRatings(title: string, year?: number, pageUrl?: string): Promise<FilmRatings | null> {
    const cleanTitle = cleanTitleForSearch(title);
    if (!cleanTitle) return null;

    const cacheKey = `${cleanTitle.toLowerCase()}:${year ?? ''}`;
    if (this.ratingsCache.has(cacheKey)) {
      return this.ratingsCache.get(cacheKey) ?? null;
    }
    if (this.ratingsPromises.has(cacheKey)) {
      return this.ratingsPromises.get(cacheKey)!;
    }

    const promise = this.fetchRatingsInternal(cleanTitle, year, pageUrl, cacheKey);
    this.ratingsPromises.set(cacheKey, promise);
    return promise;
  }

  private async fetchRatingsInternal(
    cleanTitle: string,
    year: number | undefined,
    pageUrl: string | undefined,
    cacheKey: string
  ): Promise<FilmRatings | null> {
    try {
      // 1. Check known or extracted KP ID first
      const normClean = normalizeTitle(cleanTitle);
      let knownKpId = this.knownKpIds.get(cleanTitle.toLowerCase()) 
        || this.knownKpIds.get(normClean)
        || this.kpIdByTitle.get(cleanTitle.toLowerCase())
        || this.kpIdByTitle.get(normClean)
        || KNOWN_KINOPOISK_IDS[cleanTitle.toLowerCase()]
        || KNOWN_KINOPOISK_IDS[normClean];

      if (!knownKpId) {
        for (const [key, id] of Object.entries(KNOWN_KINOPOISK_IDS)) {
          if (normClean === normalizeTitle(key) || titlesMatch(cleanTitle, key)) {
            knownKpId = id;
            break;
          }
        }
      }

      if (knownKpId) {
        const kpRatings = await this.fetchRatingsByKpId(knownKpId, cacheKey, undefined, cleanTitle, year);
        if (kpRatings && (kpRatings.kp || kpRatings.imdb)) {
          return kpRatings;
        }
      }

      const searchUrl = `https://torrentkino.org/api/search?q=${encodeURIComponent(cleanTitle)}`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': APP_USER_AGENT },
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results?: Array<{
            kinopoiskId?: string | number;
            slug?: string;
            title?: string;
            originalTitle?: string;
            year?: number;
          }>;
        };
        let match: { kinopoiskId?: string | number; slug?: string; title?: string; originalTitle?: string; year?: number } | undefined;

        if (Array.isArray(data.results) && data.results.length > 0) {
          match = data.results.find((item) => {
            if (!item.title) return false;
            const m = titlesMatch(cleanTitle, item.title, item.originalTitle);
            if (!m) return false;
            if (year && item.year && Math.abs(item.year - year) > 1) return false;
            return true;
          });
          if (!match) {
            match = data.results.find((item) => item.title && titlesMatch(cleanTitle, item.title, item.originalTitle));
          }
        }

        const kinopoiskId = match?.kinopoiskId;
        if (kinopoiskId) {
          return await this.fetchRatingsByKpId(kinopoiskId, cacheKey, match?.slug, cleanTitle, year);
        }
      }

      // 3. If pageUrl is available from release, extract Kinopoisk ID directly from page
      if (pageUrl && pageUrl.startsWith('http')) {
        try {
          const extractedKpId = await this.extractKinopoiskIdFromPage(pageUrl);
          if (extractedKpId) {
            this.kpIdByTitle.set(cleanTitle.toLowerCase(), extractedKpId);
            this.kpIdByTitle.set(normClean, extractedKpId);
            const kpRatings = await this.fetchRatingsByKpId(extractedKpId, cacheKey, undefined, cleanTitle, year);
            if (kpRatings && (kpRatings.kp || kpRatings.imdb)) {
              return kpRatings;
            }
          }
        } catch {
          // ignore
        }
      }

      // 4. Fallback: If not found in TorrentKino catalog or page, check IMDb Suggestion API
      const imdbFallback = await this.fetchImdbFallback(cleanTitle, year);
      if (imdbFallback) {
        this.ratingsCache.set(cacheKey, imdbFallback);
        return imdbFallback;
      }

      this.ratingsCache.set(cacheKey, null);
      return null;
    } catch {
      this.ratingsCache.set(cacheKey, null);
      return null;
    } finally {
      this.ratingsPromises.delete(cacheKey);
    }
  }

  private async fetchImdbId(cleanTitle: string, year?: number): Promise<string | null> {
    try {
      const suggestUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(cleanTitle)}.json`;
      const res = await fetch(suggestUrl, {
        headers: { 'User-Agent': APP_USER_AGENT },
        signal: AbortSignal.timeout(2000)
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { d?: Array<{ id?: string; l?: string; y?: number }> };
      if (!Array.isArray(data.d) || data.d.length === 0) return null;
      let match = data.d.find((item) => item.id && item.l && titlesMatch(cleanTitle, item.l));
      if (!match && year) {
        match = data.d.find((item) => item.id && item.l && titlesMatch(cleanTitle, item.l) && item.y && Math.abs(item.y - year) <= 1);
      }
      return match?.id || null;
    } catch {
      return null;
    }
  }

  private async extractKinopoiskIdFromPage(pageUrl: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      let html = '';
      if (pageUrl.includes('rutracker.org') && this.ruTrackerPageLoader) {
        html = await this.ruTrackerPageLoader(pageUrl, controller.signal);
      } else if (pageUrl.includes('nnmclub') || pageUrl.includes('megapeer') || pageUrl.includes('rutor')) {
        const encoding = pageUrl.includes('megapeer') || pageUrl.includes('nnmclub') ? 'win1251' : 'utf8';
        html = await fetchPage(pageUrl, controller.signal, encoding);
      } else {
        const res = await fetch(pageUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': APP_USER_AGENT }
        });
        if (!res.ok) return null;
        html = await res.text();
      }
      const kpMatch = html.match(/(?:kinopoisk\.ru\/(?:film|series|level\/1\/film)|rating\.kinopoisk\.ru)\/(\d+)/i);
      if (kpMatch && kpMatch[1] && kpMatch[1].length >= 4) {
        return kpMatch[1];
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchImdbFallback(cleanTitle: string, year?: number): Promise<FilmRatings | null> {
    try {
      const suggestUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(cleanTitle)}.json`;
      const res = await fetch(suggestUrl, {
        headers: { 'User-Agent': APP_USER_AGENT },
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        d?: Array<{
          id?: string;
          l?: string;
          y?: number;
          qid?: string;
        }>;
      };
      if (!Array.isArray(data.d) || data.d.length === 0) return null;

      let match = data.d.find((item) => {
        if (!item.id || !item.l) return false;
        if (!titlesMatch(cleanTitle, item.l)) return false;
        if (year && item.y && Math.abs(item.y - year) > 1) return false;
        return true;
      });
      if (!match) {
        match = data.d.find((item) => item.id && item.l && titlesMatch(cleanTitle, item.l));
      }

      if (match?.id) {
        const imdbId = match.id;
        let imdbScore: string | undefined;
        let imdbVotes: string | undefined;

        // Fetch official IMDb rating from GraphQL API
        try {
          const gqlRes = await fetch('https://api.graphql.imdb.com/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
              'x-imdb-client-name': 'imdb-web-next-release'
            },
            body: JSON.stringify({
              query: `query { title(id: "${imdbId}") { ratingsSummary { aggregateRating voteCount } } }`
            }),
            signal: AbortSignal.timeout(3000)
          });
          if (gqlRes.ok) {
            const gqlData = (await gqlRes.json()) as {
              data?: {
                title?: {
                  ratingsSummary?: {
                    aggregateRating?: number;
                    voteCount?: number;
                  };
                };
              };
            };
            const summary = gqlData.data?.title?.ratingsSummary;
            if (summary?.aggregateRating) {
              imdbScore = summary.aggregateRating.toFixed(1);
            }
            if (summary?.voteCount) {
              const n = summary.voteCount;
              imdbVotes = n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n);
            }
          }
        } catch {
          // Ignore GraphQL errors
        }

        const normClean = normalizeTitle(cleanTitle);
        let knownKpId = this.knownKpIds.get(cleanTitle.toLowerCase()) 
          || this.knownKpIds.get(normClean)
          || this.kpIdByTitle.get(cleanTitle.toLowerCase())
          || this.kpIdByTitle.get(normClean)
          || KNOWN_KINOPOISK_IDS[cleanTitle.toLowerCase()]
          || KNOWN_KINOPOISK_IDS[normClean];
        if (!knownKpId) {
          for (const [key, id] of Object.entries(KNOWN_KINOPOISK_IDS)) {
            if (normClean === normalizeTitle(key) || titlesMatch(cleanTitle, key)) {
              knownKpId = id;
              break;
            }
          }
        }
        let kpData: FilmRatings | null = null;
        if (knownKpId) {
          kpData = await this.fetchRatingsByKpId(knownKpId, `${cleanTitle.toLowerCase()}:${year ?? ''}`, undefined, cleanTitle, year);
        }

        return {
          kp: kpData?.kp,
          kpVotes: kpData?.kpVotes,
          kpReviewsUrl: kpData?.kpReviewsUrl || (knownKpId ? `https://www.kinopoisk.ru/film/${knownKpId}/reviews/` : undefined),
          kpNotFormed: kpData?.kpNotFormed,
          imdb: imdbScore || kpData?.imdb,
          imdbVotes: imdbVotes || kpData?.imdbVotes,
          imdbReviewsUrl: `https://www.imdb.com/title/${imdbId}/reviews/`,
          country: kpData?.country
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchRatingsByKpId(
    kinopoiskId: string | number,
    cacheKey: string,
    slug?: string,
    cleanTitle?: string,
    year?: number
  ): Promise<FilmRatings | null> {
    if (this.ratingsCache.has(cacheKey)) {
      return this.ratingsCache.get(cacheKey) ?? null;
    }
    try {
      const xmlPromise = fetch(`https://rating.kinopoisk.ru/${kinopoiskId}.xml`, {
        signal: AbortSignal.timeout(3000)
      });
      let pageDataPromise: Promise<{ country?: string; imdbId?: string }> = Promise.resolve({});
      if (slug) {
        pageDataPromise = fetch(`https://torrentkino.org/films/${slug}`, {
          headers: { 'User-Agent': APP_USER_AGENT },
          signal: AbortSignal.timeout(3000)
        }).then((r) => (r.ok ? r.text() : ''))
          .then((t) => {
            const m = t.match(/countryOfOrigin":\["([^"]+)"/);
            const imdbM = t.match(/tt\d{7,8}/);
            return {
              country: m ? m[1] : undefined,
              imdbId: imdbM ? imdbM[0] : undefined
            };
          })
          .catch(() => ({}));
      }

      const [xmlRes, pageData] = await Promise.all([xmlPromise, pageDataPromise]);
      if (!xmlRes.ok) {
        this.ratingsCache.set(cacheKey, null);
        return null;
      }
      const xmlText = await xmlRes.text();
      const kpMatch = xmlText.match(/<kp_rating(?:\s+num_vote=['"]([^'"]*)['"])?>([\d\.]+)<\/kp_rating>/);
      const imdbMatch = xmlText.match(/<imdb_rating(?:\s+num_vote=['"]([^'"]*)['"])?>([\d\.]+)<\/imdb_rating>/);

      const formatVotes = (str?: string) => {
        if (!str) return undefined;
        const n = parseInt(str, 10);
        if (isNaN(n) || n === 0) return undefined;
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1000) return `${Math.round(n / 1000)}K`;
        return String(n);
      };

      const kpRaw = kpMatch?.[2];
      const imdbRaw = imdbMatch?.[2];
      const kpNum = kpRaw ? parseFloat(kpRaw) : 0;
      const imdbNum = imdbRaw ? parseFloat(imdbRaw) : 0;
      const kpVotesRaw = kpMatch?.[1];
      const kpVotesNum = kpVotesRaw ? parseInt(kpVotesRaw, 10) : 0;

      // When KP rating is 0 but votes exist (e.g. reality show "Звёзды в джунглях"), rating is not formed yet
      const isKpNotFormed = kpNum === 0 && kpVotesNum > 0;

      const kpReviewsUrl = kinopoiskId ? `https://www.kinopoisk.ru/film/${kinopoiskId}/reviews/` : undefined;
      let imdbReviewsUrl = pageData.imdbId ? `https://www.imdb.com/title/${pageData.imdbId}/reviews/` : undefined;

      // If pageData had no IMDb ID, but IMDb rating exists, try looking up IMDb ID for direct reviews link
      if (!imdbReviewsUrl && imdbNum > 0 && cleanTitle) {
        const imdbId = await this.fetchImdbId(cleanTitle, year);
        if (imdbId) {
          imdbReviewsUrl = `https://www.imdb.com/title/${imdbId}/reviews/`;
        }
      }

      const ratings: FilmRatings = {
        kp: kpNum > 0 ? kpNum.toFixed(1) : (isKpNotFormed ? 'Не сформирован' : undefined),
        kpVotes: formatVotes(kpMatch?.[1]),
        kpReviewsUrl,
        kpNotFormed: isKpNotFormed ? true : undefined,
        imdb: imdbNum > 0 ? imdbNum.toFixed(1) : undefined,
        imdbVotes: formatVotes(imdbMatch?.[1]),
        imdbReviewsUrl,
        country: pageData.country
      };

      if (!ratings.kp && !ratings.imdb && !ratings.country) {
        this.ratingsCache.set(cacheKey, null);
        return null;
      }

      this.ratingsCache.set(cacheKey, ratings);
      return ratings;
    } catch {
      this.ratingsCache.set(cacheKey, null);
      return null;
    }
  }

  async resolvePoster(title: string, year?: number, pageUrl?: string, contentType?: string): Promise<string | null> {
    const cleanTitle = cleanTitleForSearch(title);
    if (!cleanTitle && !pageUrl) return null;

    const cacheKey = `${pageUrl || cleanTitle.toLowerCase()}:${year ?? ''}:${contentType ?? ''}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) ?? null;
    }

    // Check shared title cache: if another release card with same title & year already extracted/found a poster!
    if (cleanTitle) {
      const titleKey = `${cleanTitle.toLowerCase()}:${year ?? ''}:${contentType ?? ''}`;
      const titleKeyNoType = `${cleanTitle.toLowerCase()}:${year ?? ''}:`;
      let cachedTitlePoster = this.titlePosterCache.get(titleKey) || this.titlePosterCache.get(titleKeyNoType);

      // For TV series/shows or unversioned titles, share posters across seasons/years
      if (!cachedTitlePoster && (contentType === 'series' || contentType === 'reality' || !year)) {
        const seriesKey = `${cleanTitle.toLowerCase()}::${contentType || 'series'}`;
        cachedTitlePoster = this.titlePosterCache.get(seriesKey) || this.titlePosterCache.get(`${cleanTitle.toLowerCase()}::reality`);
      }

      if (cachedTitlePoster) {
        this.cache.set(cacheKey, cachedTitlePoster);
        return cachedTitlePoster;
      }
    }

    if (this.posterPromises.has(cacheKey)) {
      return this.posterPromises.get(cacheKey)!;
    }

    const promise = this.resolvePosterInternal(cleanTitle, year, pageUrl, contentType, cacheKey);
    this.posterPromises.set(cacheKey, promise);
    return promise;
  }

  private async resolvePosterInternal(
    cleanTitle: string,
    year: number | undefined,
    pageUrl: string | undefined,
    contentType: string | undefined,
    cacheKey: string
  ): Promise<string | null> {
    try {
      const storePoster = (url: string | null) => {
        this.cache.set(cacheKey, url);
        if (url && cleanTitle) {
          const titleKey = `${cleanTitle.toLowerCase()}:${year ?? ''}:${contentType ?? ''}`;
          this.titlePosterCache.set(titleKey, url);
          const titleKeyNoType = `${cleanTitle.toLowerCase()}:${year ?? ''}:`;
          this.titlePosterCache.set(titleKeyNoType, url);
          if (contentType === 'series' || contentType === 'reality') {
            this.titlePosterCache.set(`${cleanTitle.toLowerCase()}::${contentType}`, url);
            this.titlePosterCache.set(`${cleanTitle.toLowerCase()}::series`, url);
          }
        }
        return url;
      };

      // 0. Known title posters (instant 0ms lookup for common TV shows / reality)
      if (cleanTitle) {
        const normClean = normalizeTitle(cleanTitle);
        let known = KNOWN_TITLE_POSTERS[cleanTitle.toLowerCase()] || KNOWN_TITLE_POSTERS[normClean];
        if (!known) {
          for (const [key, posterUrl] of Object.entries(KNOWN_TITLE_POSTERS)) {
            if (normClean === normalizeTitle(key) || titlesMatch(cleanTitle, key)) {
              known = posterUrl;
              break;
            }
          }
        }
        if (known) {
          return storePoster(known);
        }
      }

      // 1. First priority: fast catalog search by title & year & contentType (instant 50-80ms CDN poster)
      if (cleanTitle) {
        const catalogPoster = await this.getOrSearchCatalog(cleanTitle, year, contentType);
        if (catalogPoster) {
          return storePoster(catalogPoster);
        }
      }

      // 2. Fast path for TorrentKino if not found in search: direct slug from pageUrl
      if (pageUrl && pageUrl.includes('torrentkino.org')) {
        const slugMatch = pageUrl.match(/\/films\/([^#?\/]+)/);
        if (slugMatch) {
          const url = `https://torrentkino.org/images/posters/${slugMatch[1]}.webp`;
          return storePoster(url);
        }
      }

      // 3. TMDB API search (rich coverage for TV series, shows, anime, movies with Russian metadata)
      if (cleanTitle) {
        const tmdbPoster = await this.fetchTmdbPoster(cleanTitle, year, contentType);
        if (tmdbPoster) {
          return storePoster(tmdbPoster);
        }
      }

      // 4. High quality official poster from IMDb (fast 50-100ms, highly reliable CDN, never expires or returns 404)
      if (cleanTitle) {
        const imdbPoster = await this.fetchImdbPoster(cleanTitle, year, contentType);
        if (imdbPoster) {
          return storePoster(imdbPoster);
        }
      }

      // 5. Fallback: extract poster directly from the torrent release page (for TV shows, rare items not on IMDb)
      if (pageUrl && pageUrl.startsWith('http')) {
        try {
          const pagePoster = await this.extractPosterFromPage(pageUrl, cleanTitle);
          if (pagePoster) {
            return storePoster(pagePoster);
          }
        } catch {
          // Ignore
        }
      }

      return storePoster(null);
    } finally {
      this.posterPromises.delete(cacheKey);
    }
  }

  private async fetchTmdbPoster(cleanTitle: string, year?: number, contentType?: string): Promise<string | null> {
    try {
      const isTv = contentType === 'series' || contentType === 'reality' || !contentType;
      const queries = [cleanTitle];
      const norm = normalizeTitle(cleanTitle);
      for (const [key, aliases] of Object.entries(TITLE_SEARCH_ALIASES)) {
        if (norm === normalizeTitle(key)) {
          queries.push(...aliases);
        }
      }

      for (const q of queries) {
        const endpoints = isTv ? ['search/tv', 'search/movie'] : ['search/movie', 'search/tv'];
        for (const ep of endpoints) {
          const url = `https://api.themoviedb.org/3/${ep}?query=${encodeURIComponent(q)}&api_key=${TMDB_API_KEY}&language=ru-RU`;
          const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) continue;
          const data = (await res.json()) as {
            results?: Array<{
              id?: number;
              name?: string;
              title?: string;
              original_name?: string;
              original_title?: string;
              poster_path?: string;
              origin_country?: string[];
              original_language?: string;
              first_air_date?: string;
              release_date?: string;
            }>;
          };
          if (!Array.isArray(data.results) || data.results.length === 0) continue;

          // Prioritize Russian origin for shows / domestic releases
          const results = [...data.results].sort((a, b) => {
            const aRu = (a.origin_country || []).includes('RU') || a.original_language === 'ru';
            const bRu = (b.origin_country || []).includes('RU') || b.original_language === 'ru';
            return (bRu ? 1 : 0) - (aRu ? 1 : 0);
          });

          for (const item of results) {
            if (!item.poster_path) continue;
            const candTitle = item.name || item.title || '';
            const candOrig = item.original_name || item.original_title || '';
            if (!candTitle && !candOrig) continue;

            const isMatch = titlesMatch(cleanTitle, candTitle, candOrig) || titlesMatch(q, candTitle, candOrig);
            if (!isMatch) continue;

            const firstYear = parseInt((item.first_air_date || item.release_date || '').slice(0, 4), 10);
            if (year && firstYear) {
              if (ep.includes('tv') || contentType === 'series' || contentType === 'reality') {
                if (year < firstYear - 1) continue;
              } else if (Math.abs(firstYear - year) > 1) {
                continue;
              }
            }

            return `https://image.tmdb.org/t/p/w500${item.poster_path}`;
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async fetchImdbPoster(cleanTitle: string, year?: number, contentType?: string): Promise<string | null> {
    try {
      const suggestUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(cleanTitle)}.json`;
      const res = await fetch(suggestUrl, {
        headers: { 'User-Agent': APP_USER_AGENT },
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        d?: Array<{
          id?: string;
          l?: string;
          y?: number;
          i?: { imageUrl?: string };
        }>;
      };
      if (!Array.isArray(data.d) || data.d.length === 0) return null;

      let match = data.d.find((item) => {
        if (!item.id || !item.l || !item.i?.imageUrl) return false;
        if (!titlesMatch(cleanTitle, item.l)) return false;
        if (year && item.y) {
          if (contentType === 'series' || contentType === 'reality') {
            if (year < item.y - 1) return false;
          } else if (Math.abs(item.y - year) > 1) {
            return false;
          }
        }
        return true;
      });
      if (!match) {
        match = data.d.find((item) => item.id && item.l && item.i?.imageUrl && titlesMatch(cleanTitle, item.l));
      }

      const rawImg = match?.i?.imageUrl;
      if (rawImg) {
        // Optimize Amazon image size for UI card: request standard 380px width without white canvas padding
        return rawImg.replace(/(\._V1_).*(\.jpg)$/, '$1_QL75_UX380_$2');
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getOrSearchCatalog(cleanTitle: string, year?: number, contentType?: string): Promise<string | null> {
    const catalogKey = `${cleanTitle.toLowerCase()}:${year ?? ''}:${contentType ?? ''}`;
    if (this.catalogCache.has(catalogKey)) {
      return this.catalogCache.get(catalogKey) ?? null;
    }
    if (this.catalogPromises.has(catalogKey)) {
      return this.catalogPromises.get(catalogKey)!;
    }

    const promise = (async () => {
      try {
        const result = await this.searchCatalog(cleanTitle, year, contentType);
        this.catalogCache.set(catalogKey, result);
        return result;
      } catch {
        this.catalogCache.set(catalogKey, null);
        return null;
      } finally {
        this.catalogPromises.delete(catalogKey);
      }
    })();

    this.catalogPromises.set(catalogKey, promise);
    return promise;
  }

  private async extractPosterFromPage(pageUrl: string, cleanTitle?: string): Promise<string | null> {
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
      } else if (pageUrl.includes('nnmclub') || pageUrl.includes('megapeer') || pageUrl.includes('rutor')) {
        const encoding = pageUrl.includes('megapeer') || pageUrl.includes('nnmclub') ? 'win1251' : 'utf8';
        html = await fetchPage(pageUrl, controller.signal, encoding);
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

    return this.extractPosterFromHtml(html, pageUrl, cleanTitle);
  }

  private extractPosterFromHtml(html: string, pageUrl: string, cleanTitle?: string): string | null {
    if (!html) return null;

    // 1. Check for Kinopoisk link in the release HTML (RuTracker, RuTor, NNMClub, MegaPeer)
    const kpMatch = html.match(/(?:kinopoisk\.ru\/(?:film|series|level\/1\/film)|rating\.kinopoisk\.ru)\/(\d+)/i);
    if (kpMatch && kpMatch[1] && kpMatch[1].length >= 4) {
      if (cleanTitle) {
        this.kpIdByTitle.set(cleanTitle.toLowerCase(), kpMatch[1]);
        this.kpIdByTitle.set(normalizeTitle(cleanTitle), kpMatch[1]);
      }
      return `https://st.kp.yandex.net/images/film_iphone/iphone360_${kpMatch[1]}.jpg`;
    }

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
          const url = unwrapImageUrl(urlMatch[1]);
          if (!isBadgeOrRatingImageUrl(url, fullTag) && !isDeadOrBlockedImageUrl(url)) {
            return url;
          }
        }
      }

      // Fallback: any content image inside post_body
      const anyImg = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (anyImg && anyImg[1].startsWith('http')) {
        const url = unwrapImageUrl(anyImg[1]);
        if (!isBadgeOrRatingImageUrl(url, anyImg[0]) && !isDeadOrBlockedImageUrl(url)) {
          return url;
        }
      }
    }

    // MegaPeer: first image inside #descr
    if (pageUrl.includes('megapeer')) {
      const descrMatch = html.match(/id=["']descr["'][^>]*>([\s\S]*?)<\/td>/i);
      const content = descrMatch ? descrMatch[1] : html;
      const imgMatch = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (imgMatch && imgMatch[1].startsWith('http')) {
        const url = unwrapImageUrl(imgMatch[1]);
        if (!isBadgeOrRatingImageUrl(url, imgMatch[0]) && !isDeadOrBlockedImageUrl(url)) return url;
      }
    }

    // RuTor: first image inside #details (excluding icons)
    if (pageUrl.includes('rutor')) {
      const detailsMatch = html.match(/id=["']details["'][^>]*>([\s\S]*?)<\/table>/i);
      const content = detailsMatch ? detailsMatch[1] : html;
      const imgMatch = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (imgMatch && imgMatch[1].startsWith('http')) {
        const url = unwrapImageUrl(imgMatch[1]);
        if (!url.includes('s.rutor.info') && !isBadgeOrRatingImageUrl(url, imgMatch[0]) && !isDeadOrBlockedImageUrl(url)) {
          return url;
        }
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
          const url = unwrapImageUrl(urlMatch[1]);
          if (!isBadgeOrRatingImageUrl(url, fullTag) && !isDeadOrBlockedImageUrl(url)) {
            return url;
          }
        }
      }

      // 2. Check og:image meta tag
      const ogMatch = html.match(/<meta[^>]+property=['"]og:image['"][^>]+content=['"]([^'"]+)['"]/i);
      if (ogMatch && ogMatch[1].startsWith('http')) {
        const url = unwrapImageUrl(ogMatch[1]);
        if (!/logo|icon|rss/i.test(url) && !isDeadOrBlockedImageUrl(url)) {
          return url;
        }
      }

      // 3. Fallback: first content image inside postbody
      const anyImg = content.match(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/i);
      if (anyImg && anyImg[1].startsWith('http')) {
        const url = unwrapImageUrl(anyImg[1]);
        if (!/avatar|flag|icon|smilies|rss|spacer/i.test(url) && !isDeadOrBlockedImageUrl(url)) {
          return url;
        }
      }
    }

    // Generic fallback: search for first content image (ignoring logos, buttons, counters, ratings, rss, spacers)
    const allImages = [...html.matchAll(/<img[^>]+src=['"]([^'"]+\.(?:jpg|jpeg|webp|png)(?:\?[^'"]*)?)['"]/gi)];
    for (const m of allImages) {
      const src = unwrapImageUrl(m[1]);
      if (/logo|icon|button|banner|rating|counter|smilies|avatars|tracker|download|rss|spacer|cub\d+|templates|flags|platinum|magnet/i.test(src)) continue;
      if (src.startsWith('http') && !isDeadOrBlockedImageUrl(src)) return src;
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
        kinopoiskId?: string | number;
        slug?: string;
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
    if (best && best.score > 0) {
      if (best.item.kinopoiskId) {
        const ratingsKey = `${cleanTitle.toLowerCase()}:${year ?? ''}`;
        void this.fetchRatingsByKpId(best.item.kinopoiskId, ratingsKey, best.item.slug);
      }
      if (best.item.posterUrl) {
        return best.item.posterUrl.startsWith('http')
          ? best.item.posterUrl
          : `https://torrentkino.org${best.item.posterUrl}`;
      }
      if (best.item.kinopoiskId) {
        return `https://st.kp.yandex.net/images/film_iphone/iphone360_${best.item.kinopoiskId}.jpg`;
      }
    }

    return null;
  }
}

export const posterService = new PosterService();
