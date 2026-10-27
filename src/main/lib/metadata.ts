import * as cheerio from 'cheerio';
import type { ContentType, DynamicRange, LanguageStatus, Resolution } from '../../shared/types';

const TECHNICAL_START = /\s(?:\[|\(|(?:UHD\s*)?WEB(?:[- .]|$)|WEB[- .]|BluRay|BDRemux|BDRip|HDRip|HDTV|DVDRip|DVDScr|CAMRip|TS\b|(?:2160|1440|1080|720)p\b|4K\b)/iu;

const bound = (pattern: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${pattern}(?:$|[^\\p{L}\\p{N}])`, 'iu');

const STUDIO_PATTERNS: Array<[RegExp, string]> = [
  [bound('(?:lostfilm|lost film)'), 'LostFilm'],
  [bound('(?:kubik(?: в кубе)?|кубик в кубе)'), 'Кубик в кубе'],
  [bound('newstudio'), 'NewStudio'],
  [bound('(?:a?media|амедиа)'), 'AMedia'],
  [bound('(?:hdrezka|rezka)'), 'HDRezka'],
  [bound('(?:tvshows|tv shows)'), 'TVShows'],
  [bound('(?:baibako|байбако)'), 'BaibaKo'],
  [bound('(?:jaskier|яскьер|ястреб)'), 'Jaskier'],
  [bound('(?:red head sound|rhs)'), 'Red Head Sound'],
  [bound('(?:cinema tone(?: production)?)'), 'Cinema Tone Production'],
  [bound('(?:new-team|newteam|ньютим)'), 'New-Team'],
  [bound('(?:voice project|vo production)'), 'Voice Project'],
  [bound('(?:пифагор|pifagor)'), 'Пифагор'],
  [bound('(?:мосфильм|mosfilm)'), 'Мосфильм'],
  [bound('(?:невафильм|nevafilm)'), 'Невафильм'],
  [bound('(?:кириллица)'), 'Кириллица'],
  [bound('(?:св-дубль|св дубль)'), 'СВ-Дубль'],
  [bound('(?:кравец(?:-рекордз)?)'), 'Кравец'],
  [bound('(?:кураж[- ]бамбей|kuraj[- ]bambey)'), 'Кураж-Бамбей'],
  [bound('(?:гоблин|пучков)'), 'Гоблин'],
  [bound('сербин'), 'Сербин'],
  [bound('позитив'), 'Позитив'],
  [bound('(?:alexfilm|алексфильм)'), 'AlexFilm'],
  [bound('octopus'), 'Octopus'],
  [bound('anilibria'), 'AniLibria'],
  [bound('anidub'), 'AniDUB'],
  [bound('shiza project'), 'SHIZA Project'],
  [bound('(?:flarrow films|flarrow)'), 'Flarrow Films'],
  [bound('newcomers'), 'NewComers'],
  [bound('softbox'), 'SoftBox'],
  [bound('(?:movie[- ]dalen|moviedalen)'), 'MovieDalen'],
  [bound('alphaproject'), 'AlphaProject'],
  [bound('good people'), 'Good People'],
  [bound('(?:ле-прим|le-production)'), 'LE-Production'],
  [bound('linefilm'), 'LineFilm'],
  [bound('videofilm'), 'Videofilm'],
  [bound('steponee'), 'StepOnee'],
  [bound('russian mafia'), 'Russian Mafia'],
  [bound('(?:киномания)'), 'Киномания'],
  [bound('(?:cp[- ]digital|ср-диджитал)'), 'CP-Digital']
];

export const normaliseText = (value: string): string =>
  value.toLocaleLowerCase('ru-RU').replace(/[ё]/g, 'е').replace(/[«»'"`]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();

export function titleFromRelease(rawTitle: string): { title: string; alternatives: string[]; year?: number } {
  const withoutSize = rawTitle.replace(/\[[^\]]*(?:GB|MB|TB)[^\]]*\]\s*$/iu, '').trim();
  const cut = withoutSize.search(TECHNICAL_START);
  const candidate = (cut > 0 ? withoutSize.slice(0, cut) : withoutSize)
    .replace(/\s*\[[^\]]*\]\s*$/u, '')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/u, '')
    .trim();
  const year = rawTitle.match(/(?:\(|\[|\s)(19\d{2}|20\d{2})(?:\)|\]|\s|,|$)/u)?.[1];
  const alternatives = candidate
    .split(/\s*\/(?![^()]*\))/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return { title: alternatives[0] || candidate || rawTitle, alternatives: alternatives.slice(1), year: year ? Number(year) : undefined };
}

export function exactTitleMatches(query: string, item: { title: string; alternativeTitles: string[] }): boolean {
  const wanted = normaliseText(query);
  if (!wanted) return false;
  return [item.title, ...item.alternativeTitles].some((title) => normaliseText(title) === wanted);
}

export function normalTitleMatches(query: string, item: { title: string; alternativeTitles: string[]; rawTitle: string }): boolean {
  const words = normaliseText(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return false;
  const haystack = normaliseText([item.title, ...item.alternativeTitles, item.rawTitle].join(' '));
  return words.every((word) => haystack.includes(word));
}

export function relevanceFor(query: string, title: string, alternatives: string[], rawTitle: string): number {
  const wanted = normaliseText(query);
  const candidates = [title, ...alternatives].map(normaliseText);
  if (candidates.includes(wanted)) return 1_000;
  if (candidates.some((candidate) => candidate.startsWith(wanted))) return 800;
  if (normaliseText(rawTitle).includes(wanted)) return 500;
  return wanted.split(' ').filter((word) => normaliseText(rawTitle).includes(word)).length * 100;
}

export function extractResolution(
  value: string,
  aliases: Array<{ term: string; resolution: Exclude<Resolution, 'unknown'> }> = []
): Resolution {
  if (!value) return 'unknown';

  for (const alias of aliases) {
    const term = alias.term.trim();
    if (term && new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').test(value)) {
      return alias.resolution;
    }
  }

  // 1. Explicit 4K / UHD / 2160p
  if (/(?:2160[pi]?|\b4k\b|\buhd\b|3840\s*x\s*\d{3,4}|4096\s*x\s*\d{3,4})/iu.test(value)) {
    return '2160p';
  }

  // 2. Explicit 2K / 1440p
  if (/(?:1440[pi]?|\b2k\b|2560\s*x\s*\d{3,4})/iu.test(value)) {
    return '1440p';
  }

  // 3. Explicit 1080p / 1080i / Full HD
  if (/(?:1080[pi]?|1920\s*x\s*\d{3,4}|full\s*hd|fhd)/iu.test(value)) {
    return '1080p';
  }

  // 4. Explicit 720p / 720i / HD Ready / 1280x720
  if (/(?:720p\b|720i\b|1280\s*x\s*(?:720|536|544|688|696|704|712|716|720)\b|hd\s*ready)/iu.test(value)) {
    return '720p';
  }

  // 5. Explicit 576p / 576i / 1024x576 / 720x576 (PAL SD)
  if (/(?:576[pi]?|1024\s*x\s*(?:576|540|550|560|570|572|576)\b|720\s*x\s*576\b|768\s*x\s*576\b)/iu.test(value)) {
    return '576p';
  }

  // 6. Explicit 480p / 480i / 848x480 / 854x480 / 720x480 / 704x384 / 720x400
  if (/(?:480[pi]?|720\s*x\s*(?:480|400|384|416)\b|704\s*x\s*(?:384|400|480)\b|848\s*x\s*480\b|854\s*x\s*480\b|852\s*x\s*480\b|640\s*x\s*480\b|688\s*x\s*384\b|624\s*x\s*352\b)/iu.test(value)) {
    return '480p';
  }

  // 7. Explicit 360p / 360i / 640x360
  if (/(?:360[pi]?|640\s*x\s*360\b|480\s*x\s*(?:360|272)\b|320\s*x\s*240\b)/iu.test(value)) {
    return '360p';
  }

  // 8. General Width x Height matcher anywhere in string (e.g. "1920x800", "1484x620", "1024x576", "704x384", "640x360")
  const dimMatches = [...value.matchAll(/(?:^|[^\d])(\d{3,4})\s*[xх×*]\s*(\d{3,4})(?:[^\d]|$)/giu)];
  for (const match of dimMatches) {
    const dim1 = Number(match[1]);
    const dim2 = Number(match[2]);
    const w = Math.max(dim1, dim2);
    const h = Math.min(dim1, dim2);
    if (w < 300 || w > 8000 || h < 200 || h > 5000) continue;

    if (w >= 3840 || h >= 1600) return '2160p';
    if (w >= 2560 || h >= 1300) return '1440p';
    if (w >= 1800 || h >= 800) return '1080p';
    if (w >= 1200 || h >= 500) return '720p';
    if (w >= 900 || h >= 530) return '576p';
    if (w >= 640 || h >= 370) return '480p';
    if (w >= 400 || h >= 240) return '360p';
  }

  // 9. Format-based resolution inferences when explicit numbers are absent:
  if (/(?:bdr(?:ip)?-avc|bdrip\b|bd-rip\b)/iu.test(value)) {
    return '576p';
  }
  if (/(?:dvdrip|dvd-rip|dvdscr|dvd5|dvd9|\bdvd\b)/iu.test(value)) {
    return '480p';
  }
  if (/(?:satrip|sat-rip|tvrip|tv-rip|vhsrip|vhs-rip|iptvrip)/iu.test(value)) {
    return '480p';
  }
  if (/(?:hdrip|hd-rip|web-dlrip|webrip|web-rip)/iu.test(value)) {
    return '720p';
  }

  return 'unknown';
}

export function extractDynamicRange(value: string): DynamicRange {
  if (/dolby\s*vision|\bdv\b/iu.test(value)) return 'dolby-vision';
  if (/hdr10\+/iu.test(value)) return 'hdr10plus';
  if (/hdr10(?!\+)/iu.test(value)) return 'hdr10';
  if (/\bhdr\b/iu.test(value)) return 'hdr';
  return 'sdr';
}

export function extractSeason(value: string): number | undefined {
  const match = value.match(/(?:\bS|сезон\s*|с\.)0?(\d{1,2})\b|(\d{1,2})\s*сезон/iu);
  return match ? Number(match[1] ?? match[2]) : undefined;
}

export function extractPart(value: string): number | undefined {
  const match = value.match(/(?:часть|part|глава|chapter)\s*(?:№|#)?\s*(\d{1,2})\b/iu);
  return match ? Number(match[1]) : undefined;
}

export function isTechnicalAudioJunk(val: string): boolean {
  if (!val || val.length < 2) return true;
  if (/кбит|kbps|kb\/s|кб\/с|kbit/iu.test(val)) return true;
  if (/^(?:ac-?3|e-ac-?3|dts(?:-hd)?|aac|mp3|flac|wav|lpcm)\b/iu.test(val)) return true;
  if (/\b(?:2|6)\s*ch\b|\b\d+\s*кан(?:ала)?\b|\b[1257]\.[01]\b/iu.test(val)) return true;
  if (/\b(?:stereo|surround|mono|fps|hz|khz)\b/iu.test(val)) return true;
  if (/^(?:русский|русские|english|russian|оригинал|чистый видеоряд|звук|видео|аудио)$/iu.test(val.trim())) return true;
  if (!/[a-zа-яё]/iu.test(val)) return true;
  return false;
}

export function parseAudioTrackLine(line: string): string | null {
  if (!/(?:^|[^\p{L}\p{N}])(?:Аудио|Audio|Звук)(?:\s*(?:#|№|\d+|rus|рус|[№#]\d+))*\s*[:]/iu.test(line)) {
    return null;
  }
  if (/(?:английский|english|original|оригинал|ukrainian|украинский)/iu.test(line) && !/рус|rus/iu.test(line)) {
    return null;
  }

  const afterColon = line.replace(/^(?:.*?)[:]\s*/, '').trim();

  // Pipe separated: ... |Многоголосый, закадровый Киномания (R5)| or | LostFilm
  const pipeParts = afterColon.split('|').map((s) => s.trim()).filter(Boolean);
  if (pipeParts.length > 1) {
    const candidate = pipeParts[pipeParts.length - 1];
    if (candidate && !/^(?:ac3|dts|mp3|aac|flac|wav|\d+\s*bit|\d+\s*kbps|\d+\s*fps|\d+\s*ch|чистый)/iu.test(candidate)) {
      return candidate;
    }
  }

  // Dash separated: ... - LostFilm or ... - Русский, LostFilm
  const dashParts = afterColon.split(/\s+[-–—]\s+/);
  if (dashParts.length > 1) {
    const last = dashParts[dashParts.length - 1].trim();
    if (last && !/^(?:ac3|dts|mp3|aac|flac|\d+\s*kbps|русский|английский)/iu.test(last)) {
      const rusComma = last.match(/(?:Русский|Russian)[^-,:()]*[-:,]\s*(.+)/iu);
      if (rusComma) return rusComma[1].trim();
      return last;
    }
  }

  // Comma or colon after Russian: Русский, LostFilm
  const rusMatch = afterColon.match(/(?:Русский|Russian)[^-,:()]*[-:,]\s*([^<,\n\r]+(?:\([^)]+\))?)/iu);
  if (rusMatch) {
    const candidate = rusMatch[1].trim();
    if (candidate && !/^(?:ac3|dts|mp3|aac|flac|\d+\s*kbps)/iu.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function parseTrackerVoiceTags(rawTitle: string): string[] {
  const match = rawTitle.match(/\|\s*([^|\[\]()]+?)\s*$/u);
  if (!match) return [];
  const parts = match[1].split(',').map((s) => s.trim().toUpperCase());
  const voices: string[] = [];
  for (const p of parts) {
    if (p === 'D' || p === 'Д' || p === 'DUB') voices.push('Дублированный');
    else if (p === 'P' || p === 'П' || p === 'MVO' || p === 'МВО') voices.push('Многоголосый');
    else if (p === 'P2' || p === 'П2' || p === 'DVO' || p === 'ДВО') voices.push('Двухголосый');
    else if (p === 'A' || p === 'А' || p === 'AVO' || p === 'АВО') voices.push('Авторский (одноголосый)');
    else if (p === 'L' || p === 'Л' || p === 'L1' || p === 'Л1') voices.push('Любительский одноголосый');
    else if (p === 'L2' || p === 'Л2') voices.push('Любительский двухголосый');
  }
  return voices;
}

export function parseTranslationLine(val: string): string[] {
  val = val.replace(/<[^>]+>/g, '').replace(/^[✦•-]\s*/, '').trim();
  const cutIdx = val.search(/(?:Язык|Субтитры|Видео|Аудио|Качество|Продолжительность)/iu);
  if (cutIdx > 0) val = val.slice(0, cutIdx).trim();

  // Pattern 1: Type (details) Studio, e.g. "профессиональный (многоголосый, закадровый) AlexFilm" or "- LostFilm"
  const m1 = val.match(/^(?:профессиональный|любительский|авторский)?\s*\(([^)]+)\)\s*[-:]?\s*([A-Za-zА-Яа-я0-9\s._-]+)?$/iu);
  if (m1) {
    const inside = m1[1].trim();
    const studio = m1[2] ? m1[2].trim() : '';
    if (studio && !/^(?:русский|полное|лицензия)$/iu.test(studio)) {
      let type = 'Многоголосый закадровый';
      if (/двухголос/iu.test(inside)) type = 'Двухголосый закадровый';
      else if (/одноголос|авторск/iu.test(inside)) type = 'Одноголосый закадровый';
      else if (/дубл/iu.test(inside)) type = 'Дублированный';
      return [`${type} (${studio})`];
    }
  }

  // Pattern 2: "Дублированный (Cinema Tone Production, HDRezka Studio)"
  const m2 = val.match(/^([^(]+)\(([^)]+)\)$/);
  if (m2) {
    const prefix = m2[1].trim().replace(/^профессиональный\s+/iu, '');
    const inner = m2[2].split(',').map((s) => s.trim()).filter(Boolean);
    if (inner.length > 1) {
      return inner.map((s) => `${prefix} (${s})`);
    }
  }

  // Pattern 3: "Дублированный - Мосфильм"
  const m3 = val.match(/^([^-:]+)\s*[-:]\s*([^-:]+)$/);
  if (m3 && !/^\d+$/.test(m3[2].trim())) {
    return [`${m3[1].trim()} (${m3[2].trim()})`];
  }

  return [val];
}

export function cleanAndDeduplicateVoices(list: string[]): string[] {
  if (!list || !list.length) return [];

  const rawEntries: string[] = [];

  for (const raw of list) {
    if (!raw) continue;
    let clean = raw
      .replace(/^(?:AC-?3|AAC|DTS|FLAC|MP3)[^-\n]*-\s*/iu, '')
      .replace(/^(?:Русский|Russian)\s*[-:]\s*/iu, '')
      .replace(/^(?:Русский|Russian)\s*\(([^)]+)\)$/iu, '$1')
      .replace(/\s*\((?:неофициальный|официальный)\)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (isTechnicalAudioJunk(clean)) continue;

    const multMatch = clean.match(/^([^(]+)\(([^)]+)\)$/u);
    if (multMatch) {
      const prefix = multMatch[1].trim();
      const inner = multMatch[2].split(',').map((s) => s.trim()).filter(Boolean);
      if (inner.length > 1) {
        for (const sub of inner) {
          rawEntries.push(`${prefix} (${sub})`);
        }
        continue;
      }
    }

    if (clean.includes(' | ')) {
      const parts = clean.split(' | ').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 2 && /дубл|закадр|проф|многоголос/iu.test(parts[0])) {
        clean = `${parts[0]} (${parts[1]})`;
      }
    }

    rawEntries.push(clean);
  }

  const normalized: string[] = [];
  for (let item of rawEntries) {
    if (isTechnicalAudioJunk(item)) continue;

    item = item
      .replace(/^DUB,\s*/iu, 'Дублированный (')
      .replace(/^DUB$/iu, 'Дублированный')
      .replace(/^MVO,\s*/iu, 'Многоголосый (')
      .replace(/^MVO$/iu, 'Многоголосый')
      .replace(/^DVO,\s*/iu, 'Двухголосый (')
      .replace(/^DVO$/iu, 'Двухголосый')
      .replace(/^AVO,\s*/iu, 'Одноголосый (')
      .replace(/^AVO$/iu, 'Одноголосый (AVO)');
    if (item.includes('(') && !item.includes(')')) item += ')';

    item = item
      .replace(/^Профессиональный\s+\(дублированный\)/iu, 'Дублированный')
      .replace(/^Профессиональный\s+дублированный/iu, 'Дублированный')
      .replace(/^Полное\s+дублирование/iu, 'Дублированный')
      .replace(/^Профессиональный\s+\(многоголосый[^)]*\)/iu, 'Многоголосый закадровый')
      .replace(/^Профессиональный\s+многоголосый/iu, 'Многоголосый закадровый')
      .replace(/^Любительский\s+\(многоголосый[^)]*\)/iu, 'Любительский многоголосый')
      .replace(/^Любительский\s+\(двухголосый[^)]*\)/iu, 'Любительский двухголосый')
      .replace(/^Авторский\s+\(одноголосый[^)]*\)/iu, 'Авторский одноголосый')
      .trim();

    // Handle "Многоголосый, закадровый Киномания (R5)"
    const typeMatch = item.match(/^(Многоголосый|Двухголосый|Одноголосый),\s*закадровый\s*(.+)$/iu);
    if (typeMatch) {
      item = `${typeMatch[1]} закадровый (${typeMatch[2].trim()})`;
    }

    if (item && !isTechnicalAudioJunk(item)) {
      item = item.charAt(0).toUpperCase() + item.slice(1);
      normalized.push(item);
    }
  }

  const result: string[] = [];
  for (const item of normalized) {
    if (!item || isTechnicalAudioJunk(item)) continue;

    const itemLower = item.toLowerCase();
    const hasDetailed = normalized.some((other) => {
      if (other === item) return false;
      const otherLower = other.toLowerCase();
      if (
        otherLower.includes(`(${itemLower})`) ||
        otherLower.includes(`(${itemLower},`) ||
        otherLower.includes(`, ${itemLower})`)
      ) {
        return true;
      }
      if (!itemLower.includes('(')) {
        if (
          (itemLower === 'профессиональный' || itemLower === 'любительский' || itemLower === 'авторский') &&
          otherLower.includes('(')
        ) {
          return true;
        }
        if (itemLower.includes('дублирован') && otherLower.includes('дублирован') && otherLower.includes('(')) return true;
        if (itemLower.includes('многоголос') && otherLower.includes('многоголос') && otherLower.includes('(')) return true;
        if (itemLower.includes('двухголос') && otherLower.includes('двухголос') && otherLower.includes('(')) return true;
        if (itemLower.includes('одноголос') && otherLower.includes('одноголос') && otherLower.includes('(')) return true;
      }
      return false;
    });

    if (!hasDetailed && !result.some((r) => r.toLowerCase() === itemLower)) {
      result.push(item);
    }
  }

  return result;
}

export function extractStudios(value: string, additional: string[] = []): string[] {
  const studios: string[] = [];
  for (const [pattern, studio] of STUDIO_PATTERNS) {
    if (pattern.test(value)) studios.push(studio);
  }
  for (const studio of additional) {
    if (studio.trim() && new RegExp(studio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').test(value)) {
      studios.push(studio.trim());
    }
  }

  const trackerTags = parseTrackerVoiceTags(value);
  if (trackerTags.length > 0) {
    studios.push(...trackerTags);
  }

  // Trailing studio after "|" in release title (e.g. "... WEB-DL 1080p | NewComers")
  if (studios.length === 0) {
    const trailingMatch = value.match(/\|\s*([^|\[\]()]+?)\s*$/u);
    if (trailingMatch) {
      const candidate = trailingMatch[1].trim();
      if (
        candidate.length >= 2 &&
        candidate.length <= 35 &&
        !isTechnicalAudioJunk(candidate) &&
        !/(?:2160|1440|1080|720)p?|uhd|4k|hdr|sdr|web|rip|bd|dvd|remux|h\.?26[45]|hevc|avc|av1|x26[45]|aac|ac3|\b[DPLARДПЛАР]\b|\b(?:dub|mvo|dvo|avo)\b/iu.test(candidate)
      ) {
        studios.push(candidate);
      }
    }
  }

  if (studios.length === 0) {
    if (/(?:^|[^\p{L}\p{N}])(?:дублирован|дубляж|\bdub\b|\|\s*[DД]\b)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Дублированный');
    } else if (/(?:^|[^\p{L}\p{N}])(?:многоголосый|\bmvo\b|\|\s*(?:MVO|МВО)\b)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Многоголосый');
    } else if (/(?:^|[^\p{L}\p{N}])(?:двухголосый|\bdvo\b|\|\s*(?:DVO|ДВО)\b)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Двухголосый');
    } else if (/(?:^|[^\p{L}\p{N}])(?:одноголосый|авторский|\bavo\b|\|\s*(?:AVO|АВО)\b)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Одноголосый (AVO)');
    } else if (/\|\s*[PП]\b/iu.test(value)) {
      studios.push('Профессиональный');
    } else if (/\|\s*(?:L\d?|Л)\b/iu.test(value)) {
      studios.push('Любительский');
    } else if (/(?:^|[^\p{L}\p{N}])(?:itunes|лицензия)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Лицензия');
    } else if (/(?:^|[^\p{L}\p{N}])(?:кинопоиск|okko|ivi|иви|start|kion|premier)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Лицензия (Цифра)');
    } else if (/(?:^|[^\p{L}\p{N}])(?:маски[- ]шоу|шоу\s+маска|квн|comedy|уральские пельмени)(?:$|[^\p{L}\p{N}])/iu.test(value)) {
      studios.push('Оригинал');
    }
  }
  return cleanAndDeduplicateVoices(studios);
}

export interface TopicDetails {
  magnetUrl?: string;
  translations: string[];
  resolution?: Resolution;
  dynamicRange?: DynamicRange;
}

export function parseTopicHtml(html: string, customStudios: string[] = []): TopicDetails {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h\d)>/gi, '\n');
  const $ = cheerio.load(withBreaks);

  const magnetUrl = $('a[href^="magnet:"]').first().attr('href')
    || html.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,64}[^\s"'<>]+/i)?.[0];

  const text = $('body').text();
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  const translations: string[] = [];
  let videoText = '';

  for (const line of lines) {
    const trMatch = line.match(/(?:^|[^\p{L}\p{N}])(?:Перевод(?:\s*\d+)?|Озвучка)\s*:\s*(.+)$/iu);
    if (trMatch) {
      if (/(?:не\s*требуется|отсутствует|оригинал)/iu.test(trMatch[1])) {
        translations.push('Оригинал');
      } else {
        const parsedLines = parseTranslationLine(trMatch[1]);
        for (const val of parsedLines) {
          if (val && !isTechnicalAudioJunk(val) && !translations.includes(val)) {
            translations.push(val);
          }
        }
      }
    }
    const audTrack = parseAudioTrackLine(line);
    if (audTrack && !isTechnicalAudioJunk(audTrack) && !translations.includes(audTrack)) {
      translations.push(audTrack);
    }
    const vidMatch = line.match(/(?:^|[^\p{L}\p{N}])(?:Видео|Качество(?: видео)?|Разрешение(?: экрана| видео)?|Параметры видео|Video(?:\s*quality)?|Resolution)\s*:\s*(.+)$/iu);
    if (vidMatch) {
      videoText = videoText ? `${videoText} | ${vidMatch[1]}` : vidMatch[1];
    } else if (/(?:\d{3,4}\s*[xх×*]\s*\d{3,4}|(?:2160|1440|1080|720|576|480|360)[pi]\b)/iu.test(line)) {
      videoText = videoText ? `${videoText} | ${line}` : line;
    }
  }

  const studiosFromText = extractStudios(text, customStudios);
  for (const s of studiosFromText) {
    if (!translations.some((t) => t.toLowerCase().includes(s.toLowerCase()))) {
      translations.push(s);
    }
  }

  if (translations.length === 0) {
    if (/(?:^|\s)(?:Язык|Оригинальный\s+звук)\s*:\s*Русский(?:\s*\(оригинал\))?/iu.test(text) ||
        /(?:русский\s+оригинал|оригинальная\s+русская\s+дорожка|язык:\s*русский)/iu.test(text)) {
      translations.push('Оригинал');
    }
  }

  let res = videoText ? extractResolution(videoText) : 'unknown';
  if (res === 'unknown') {
    res = extractResolution(text);
  }
  const range = videoText ? extractDynamicRange(videoText) : extractDynamicRange(text);

  return {
    magnetUrl,
    translations: cleanAndDeduplicateVoices(translations),
    resolution: res !== 'unknown' ? res : undefined,
    dynamicRange: range
  };
}

export function russianLanguageStatus(value: string, studios: string[]): LanguageStatus {
  if (studios.length > 0) return 'confirmed';
  return /(?:\b(?:rus|ru)\b|рус(?:ский|ская|ская озвучка|\.)|дублирован|дубляж|\bдуб\b|многоголос|\bмво\b|двухголос|\bдво\b|одноголос|\bаво\b|закадров|профессиональн(?:ый|ая) перевод|\b(?:mvo|dvo|avo|d\.?l\.)\b|\bлицензия\b|\|\s*(?:[DPLAR]|Р|L\d?)\b|\|\s*[^|]*(?:[DPLAR]|Р|L\d?)(?:\s*,\s*(?:[DPLAR]|Р|L\d?))*\s*(?:\||$)|itunes|кинопоиск|okko|ivi|start|kion|premier)/iu.test(value)
    ? 'confirmed'
    : 'unknown';
}

export function isVideoRelease(rawTitle: string, category?: string): boolean {
  const normCat = (category || '').toLowerCase();

  // 1. Check tracker category / forum name if available
  if (normCat) {
    const nonVideoCat = /(?:музык|саундтрек|soundtrack|\bost\b|дискографи|песни|клип[ы]|audio|аудио|игр[ыа]|games?|soft|софт|программ|книг[иа]|журнал|литератур|обои|шрифт|картинк|фото|график|клипарт|разное|распечатай|настольн|дизайн|моделир)/iu;
    if (nonVideoCat.test(normCat)) {
      return false;
    }
  }

  // Strong video indicators (video quality, rip type, resolution, video codecs)
  const hasVideoIndicator = /(?:bdr(?:ip)?|web-?dl(?:rip)?|web-?rip|dvd(?:rip)?|dvd-?[59]|sat-?rip|iptv|hdtv(?:rip)?|blu-?ray|remux|telecine|telesync|camrip|\b2160[pi]?\b|\b1440[pi]?\b|\b1080[pi]?\b|\b720[pi]?\b|\b576[pi]?\b|\b480[pi]?\b|\b360[pi]?\b|\b4k\b|\buhd\b|\bhevc\b|\bavc\b|\bx264\b|\bx265\b|\bh\.?264\b|\bh\.?265\b|\d{3,4}\s*[xх×]\s*\d{3,4})/iu.test(rawTitle);

  // 2. Music / Soundtrack indicators in title:
  // If explicitly marked as soundtrack/score and lacks video indicators
  if (/(?:\((?:ost|score)\)|\[(?:ost|score)\]|\bost\b|\bscore\b|soundtrack|саундтрек|музыка из фильма|музыка к фильму)/iu.test(rawTitle)) {
    if (!hasVideoIndicator) {
      return false;
    }
  }

  // Pure music album markers
  if (/(?:дискография|discography|audio\s*cd|vinyl\s*rip|\bvinyl\b)/iu.test(rawTitle)) {
    if (!hasVideoIndicator) {
      return false;
    }
  }

  // Audio formats and bitrates (MP3, FLAC, APE, ALAC, WAV, M4A, AAC, OGG, WMA, CUE, 320 kbps, Lossless, etc.) -
  // ONLY filtered out if there are NO video indicators in the release title, so movie releases
  // with audio specifications (e.g. "BDRip 1080p | AC3 384 kbps, MP3 320 kbps, FLAC") are never rejected.
  if (!hasVideoIndicator) {
    if (/(?:\bmp3\b|\bflac\b|\bape\b|\balac\b|\bwav\b|\bm4a\b|\baac\b|\bogg\b|\bwma\b|\bdsd\b|\bsacd\b|\bcue\b|lossless|\b(?:320|256|192|128)\s*kbps\b|\bkbps\b)/iu.test(rawTitle)) {
      return false;
    }
    if (/(?:дискография|discography|audio\s*cd|vinyl\s*rip|\bvinyl\b|\bсингл\b|\bsingle\b|\balbum\b|\bальбом\b|\bсборник\b|\bтреки\b|\bпесни\b)/iu.test(rawTitle)) {
      return false;
    }
    // Graphics, pictures, wallpapers, printables, DIY
    if (/(?:\[[^\]]*\b(?:png|jpg|jpeg|psd|raw|tiff|bmp|svg|ai|eps)\b[^\]]*\]|\bpng\b|\bpsd\b|\btiff\b|\bвектор\b|\bклипарт\b|\bобои\b|\bwallpapers?\b)/iu.test(rawTitle)) {
      return false;
    }
    if (/(?:распечатай\s*и\s*играй|декор\s*своими\s*руками|своими\s*руками|настольн(?:ая|ые)\s*игр(?:а|ы)|бумажн(?:ая|ое|ый)\s*модел)/iu.test(rawTitle)) {
      return false;
    }
    // Books, comics, manga, documents
    if (/(?:\bfb2\b|\bepub\b|\bdjvu\b|\bкомикс[ы]?\b|\bcomics\b|\bmanga\b|\bманга\b|\bpdf\b|аудиокнига|аудиокниги|читает\s*:)/iu.test(rawTitle)) {
      return false;
    }
    // Software, OS, drivers, APKs
    if (/(?:repack\s*&\s*portable|\bportable\b|portable\s*by|драйвер|windows\s*(?:10|11|7|xp)\s*(?:pro|home|x64)|\.apk\b|\bapk\b|\bandroid\b|macos|linux|\biso\b|образ\s*диска|патч|русификатор|crack|keygen)/iu.test(rawTitle)) {
      return false;
    }
  }

  // 3. Games indicators in title:
  if (/(?:repack\s+от|repack\s+by|fitgirl|хатаб|xatab|механики|\[pc\]|\[ps[345]\]|\[xbox|\[switch\]|gog\s*rip|steam\s*rip)/iu.test(rawTitle)) {
    return false;
  }

  return true;
}

export function detectContentType(value: string): Exclude<ContentType, 'all'> {
  if (/реалити|reality\s*show|шоу\b/iu.test(value)) return 'reality';
  if (/(?:\bS\d{1,2}\b|сезон|с\.\d{1,2}\b|серии|эпизод|season)/iu.test(value)) return 'series';
  return 'movie';
}

export function parseSizeBytes(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.replace(',', '.').match(/([\d.]+)\s*(?:гб|gb|ги?б|мб|mb|ми?б|тб|tb|ти?б|kb|кб)/iu);
  if (!match) return undefined;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return undefined;
  const unit = match[0].toLocaleLowerCase('ru-RU');
  if (/тб|tb|тиб/u.test(unit)) return Math.round(number * 1024 ** 4);
  if (/гб|gb|гиб/u.test(unit)) return Math.round(number * 1024 ** 3);
  if (/мб|mb|миб/u.test(unit)) return Math.round(number * 1024 ** 2);
  return Math.round(number * 1024);
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return 'Не указано';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function parseRussianDate(value?: string): string | undefined {
  if (!value) return undefined;
  const iso = Date.parse(value);
  if (!Number.isNaN(iso)) return new Date(iso).toISOString();
  const months: Record<string, number> = { янв: 0, фев: 1, мар: 2, апр: 3, май: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 };
  const match = value.match(/(\d{1,2})\s+([А-Яа-я]{3})\s+(\d{2,4})/u);
  if (!match || months[match[2].slice(0, 3).toLocaleLowerCase('ru-RU')] === undefined) return undefined;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  return new Date(Date.UTC(year, months[match[2].slice(0, 3).toLocaleLowerCase('ru-RU')], Number(match[1]))).toISOString();
}
