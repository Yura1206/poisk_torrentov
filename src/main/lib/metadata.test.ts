import { describe, expect, it } from 'vitest';
import type { DynamicRange, Resolution, TorrentResult } from '../../shared/types';
import { emptyFilters, filterResults, sortResults } from './filter-engine';
import {
  cleanAndDeduplicateVoices,
  detectContentType, exactTitleMatches, extractDynamicRange, extractPart, extractResolution,
  extractSeason, extractStudios, isVideoRelease, normalTitleMatches, parseSizeBytes, parseTopicHtml,
  parseTrackerVoiceTags, russianLanguageStatus, titleFromRelease
} from './metadata';

const base = (override: Partial<TorrentResult> = {}): TorrentResult => ({
  id: 'rutor:1', providerId: 'rutor', providerName: 'RuTor', rawTitle: 'Интерстеллар / Interstellar (2014) 1080p HDR DUB [Мосфильм]', title: 'Интерстеллар', alternativeTitles: ['Interstellar'], year: 2014, contentType: 'movie', season: undefined, part: undefined, resolution: '1080p', dynamicRange: 'hdr', studios: ['Мосфильм'], languageStatus: 'confirmed', sizeBytes: 10 * 1024 ** 3, sizeLabel: '10 ГБ', fileCount: undefined, seeds: 40, leeches: 2, publishedAt: '2025-01-01T00:00:00.000Z', updatedAt: undefined, pageUrl: 'https://example.org/torrent/1', relevance: 1000, ...override
});

describe('метаданные релизов', () => {
  it('сравнивает точное название без учёта регистра', () => {
    expect(exactTitleMatches('  ИНТЕРСТЕЛЛАР ', base())).toBe(true);
    expect(exactTitleMatches('interstellar', base())).toBe(true);
  });
  it('не считает часть более длинного названия точным совпадением', () => {
    const dune = base({ title: 'Дюна: Часть вторая', alternativeTitles: [], rawTitle: 'Дюна: Часть вторая (2024) WEB-DL 1080p' });
    expect(exactTitleMatches('Дюна', dune)).toBe(false);
    expect(normalTitleMatches('дюна часть', dune)).toBe(true);
  });
  it('выделяет название и год из строки релиза', () => {
    expect(titleFromRelease('Интерстеллар / Interstellar (2014) UHD BDRemux 2160p HDR').title).toBe('Интерстеллар');
    expect(titleFromRelease('Интерстеллар / Interstellar (2014) UHD BDRemux 2160p HDR').year).toBe(2014);
  });
  it('определяет все требуемые разрешения', () => {
    expect(extractResolution('WEB-DL 720p')).toBe('720p');
    expect(extractResolution('BluRay 1080p')).toBe('1080p');
    expect(extractResolution('WEB 1440p')).toBe('1440p');
    expect(extractResolution('UHD 4K')).toBe('2160p');
    expect(extractResolution('MPEG-4 AVC, 1484x620')).toBe('720p');
    expect(extractResolution('HEVC/H.265, 3840x2160')).toBe('2160p');
    expect(extractResolution('1920x1080 Full HD')).toBe('1080p');
    expect(extractResolution('720x400 (16:9)')).toBe('480p');
    expect(extractResolution('704x384 DVDRip')).toBe('480p');
    expect(extractResolution('1024x576 BDRip-AVC')).toBe('576p');
    expect(extractResolution('640x360 WEBRip')).toBe('360p');
    expect(extractResolution('Викинги [1-6 сезон] (2013-2019) WEB-DLRip')).toBe('720p');
    expect(extractResolution('1920x804, ~958 Kbps')).toBe('1080p');
  });
  it('различает SDR, HDR и варианты HDR, по умолчанию помечает как SDR', () => {
    expect(extractDynamicRange('WEB-DL SDR')).toBe('sdr');
    expect(extractDynamicRange('WEB-DL HDR')).toBe('hdr');
    expect(extractDynamicRange('HDR10 2160p')).toBe('hdr10');
    expect(extractDynamicRange('HDR10+ 2160p')).toBe('hdr10plus');
    expect(extractDynamicRange('Dolby Vision 2160p')).toBe('dolby-vision');
    expect(extractDynamicRange('BDRip 1080p')).toBe('sdr');
    expect(extractDynamicRange('WEB-DL 720p')).toBe('sdr');
  });
  it('извлекает сезоны, части и студии', () => {
    expect(extractSeason('S03 1-8')).toBe(3);
    expect(extractSeason('2 сезон, 10 серий')).toBe(2);
    expect(extractPart('Дюна: Часть 2')).toBe(2);
    expect(extractStudios('LostFilm, русская озвучка')).toContain('LostFilm');
    expect(extractStudios('Релиз: Кубик в кубе')).toContain('Кубик в кубе');
    expect(extractStudios('Перевод: Cinema Tone Production')).toContain('Cinema Tone Production');
    expect(extractStudios('Астрал 6 WEB-DL от New-Team | D, P')).toContain('New-Team');
    expect(extractStudios('Интерстеллар BDRip 1080p | Dub')).toContain('Дублированный');
    expect(extractStudios('Аватар BDRip 1080p | MVO')).toContain('Многоголосый');
    expect(extractStudios('Викинги: Вальхалла [3 сезон] (2024) WEB-DL 1080p | NewComers')).toContain('NewComers');
    expect(extractStudios('Викинги S05 (2017) BDRip-HEVC 1080p от Rips-Club | P')).not.toContain('Rips-Club');
    expect(extractStudios('Викинги S05 (2017) BDRip-HEVC 1080p от Rips-Club | P')).toContain('Многоголосый');
    expect(parseTrackerVoiceTags('Маска / The Mask (1994) BDRip 720p | D, P, P2, A, L1')).toEqual([
      'Дублированный',
      'Многоголосый',
      'Двухголосый',
      'Авторский (одноголосый)',
      'Любительский одноголосый'
    ]);
    expect(russianLanguageStatus('WEB-DL', ['LostFilm'])).toBe('confirmed');
    expect(russianLanguageStatus('WEB-DL, original audio', [])).toBe('unknown');
    expect(russianLanguageStatus('Фильм (2024) BDRip | D, P, A | Лицензия', [])).toBe('confirmed');
    expect(russianLanguageStatus('Фильм (2025) BDRip 1080p | Р | Кирилица', [])).toBe('confirmed');
    expect(russianLanguageStatus('Фильм (2024) BDRip 720p | L1', [])).toBe('confirmed');
    expect(detectContentType('S01 сериал')).toBe('series');
  });
  it('отличает видео от музыки/OST, игр, книг и программ', () => {
    expect(isVideoRelease('Пока не сыграл в ящик / The Bucket List (2007) BDRip-AVC 1080p | Dub')).toBe(true);
    expect(isVideoRelease('Пока не сыграл в ящик / The Bucket List (OST) [2007, Score, FLAC]')).toBe(false);
    expect(isVideoRelease('Пока не сыграл в ящик (Марк Шейман) [2007, OST, MP3, 320 kbps]')).toBe(false);
    expect(isVideoRelease('Саундтрек к фильму', 'Саундтреки к фильмам')).toBe(false);
    expect(isVideoRelease('Grand Theft Auto V [RePack от FitGirl]')).toBe(false);
    expect(isVideoRelease('Дюна: Часть вторая [EPUB, FB2]')).toBe(false);
    expect(isVideoRelease('Adobe Photoshop Portable')).toBe(false);
    expect(isVideoRelease('Налево от лифта (1988) DVDRip')).toBe(true);
    // Проверка музыки и аудиоальбомов (Михей и Джуманджи MP3, FLAC и т.п.)
    expect(isVideoRelease('Михей и Джуманджи - Смысл прост (2003) MP3')).toBe(false);
    expect(isVideoRelease('Михей и Джуманджи - Сука Любовь [3 издания] (1999-2005) FLAC')).toBe(false);
    expect(isVideoRelease('Михей и Джуманджи. Сука Любовь (1999) 2002 MP3')).toBe(false);
    expect(isVideoRelease('OST - Джуманджи / Jumanji - Soundtrack [Complete Score] [James Horner] (1995) MP3')).toBe(false);
    expect(isVideoRelease('by Svetic - "Jumanji/Джуманджи". Декор своими руками (Распечатай и играй) [2011, PNG, ENG]', 'Картинки')).toBe(false);
    expect(isVideoRelease('by Svetic - "Jumanji/Джуманджи". Декор своими руками (Распечатай и играй) [2011, PNG, ENG]')).toBe(false);
    expect(isVideoRelease('Джуманджи / Jumanji (1996) [Сезон 1-3] SATRip')).toBe(true);
    expect(isVideoRelease('Интерстеллар (2014) BDRip 1080p [D, P | AC3 384 kbps, MP3 320 kbps]')).toBe(true);
    expect(isVideoRelease('Матрица (1999) BDRip-AVC 1080p | Dub, Original [FLAC 5.1, AC3 640 kbps]')).toBe(true);
    expect(isVideoRelease('Фильм (1995) DVDRip [AC3, 2ch, 192 kbps]')).toBe(true);
    expect(isVideoRelease('Сериал S01 (2023) WEB-DL 720p [256 kbps]')).toBe(true);
  });
  it('разбирает размер независимо от отображения', () => {
    expect(parseSizeBytes('1.5 GB')).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseSizeBytes('нет данных')).toBeUndefined();
  });
});

describe('фильтрация и сортировка', () => {
  const film = base();
  const unknown = base({ id: 'rutor:2', year: undefined, resolution: 'unknown', languageStatus: 'unknown', seeds: undefined, sizeBytes: undefined, publishedAt: undefined, studios: [] });
  const series = base({ id: 'nnm:1', providerId: 'nnmclub', providerName: 'NoNameClub', contentType: 'series', season: 2, resolution: '2160p', dynamicRange: 'dolby-vision', studios: ['LostFilm'], seeds: 2, sizeBytes: 2 * 1024 ** 3, title: 'Тестовый сериал' });
  it('не пропускает неизвестные значения через конкретный фильтр', () => {
    const filters = { ...emptyFilters(), resolutions: ['1080p'] as Resolution[] };
    expect(filterResults([film, unknown], filters).map((item) => item.id)).toEqual(['rutor:1']);
  });
  it('фильтрует результаты по выбранному источнику (трекеру)', () => {
    const filters = { ...emptyFilters(), providers: ['nnmclub'] };
    expect(filterResults([film, series], filters).map((item) => item.id)).toEqual(['nnm:1']);
  });
  it('фильтрует результаты по выбранному году выхода', () => {
    const filters = { ...emptyFilters(), years: [2014] };
    expect(filterResults([film, unknown], filters).map((item) => item.id)).toEqual(['rutor:1']);
  });
  it('совместно применяет фильтры', () => {
    const filters = { ...emptyFilters(), resolutions: ['2160p'] as Resolution[], dynamicRanges: ['hdr'] as DynamicRange[], seasons: [2], studios: ['LostFilm'], language: 'confirmed' as const };
    expect(filterResults([film, series, unknown], filters).map((item) => item.id)).toEqual(['nnm:1']);
  });
  it('сбрасывает фильтры до исходного состояния (показывает все раздачи)', () => {
    expect(filterResults([film, unknown], emptyFilters()).map((item) => item.id)).toEqual(['rutor:1', 'rutor:2']);
  });
  it('сортирует по сидам, размеру, датам и названию с неизвестными в конце', () => {
    expect(sortResults([unknown, film, series], { field: 'seeds', direction: 'desc' }).map((item) => item.id)).toEqual(['rutor:1', 'nnm:1', 'rutor:2']);
    expect(sortResults([unknown, film, series], { field: 'size', direction: 'asc' }).map((item) => item.id)[0]).toBe('nnm:1');
    expect(sortResults([film, series], { field: 'title', direction: 'asc' })[0].title).toBe('Интерстеллар');
    expect(sortResults([unknown, film], { field: 'published', direction: 'desc' })[0].id).toBe('rutor:1');
  });
});

describe('parseTopicHtml', () => {
  it('извлекает magnet, озвучку/перевод, разрешение и динамический диапазон со страницы раздачи', () => {
    const sampleHtml = `
      <html>
        <body>
          <a href="magnet:?xt=urn:btih:96A02183B6C6B117D7DD94022CF7C99770C98296&dn=test">Скачать magnet</a>
          <br />
          <b>Перевод:</b> Дублированный (Cinema Tone Production)<br />
          <b>Язык озвучки:</b> Русский, Английский<br />
          <b>Видео:</b> HEVC/H.265, 3840x2160, ~24.4 Mbps<br />
          <b>Аудио 1:</b> AC3, 2 ch, 192 Kbps - Русский (DUB, Cinema Tone Production)<br />
        </body>
      </html>
    `;

    const details = parseTopicHtml(sampleHtml);
    expect(details.magnetUrl).toBe('magnet:?xt=urn:btih:96A02183B6C6B117D7DD94022CF7C99770C98296&dn=test');
    expect(details.translations).toContain('Дублированный (Cinema Tone Production)');
    expect(details.resolution).toBe('2160p');
    expect(details.dynamicRange).toBe('sdr');
  });

  it('очищает и дедуплицирует списки переводов и озвучек', () => {
    const raw = [
      'Дублированный (Cinema Tone Production, HDRezka Studio)',
      'DUB, Cinema Tone Production',
      'DUB, HDRezka Studio',
      'Дублированный',
      'Cinema Tone Production',
      'AC3, 2 ch, 192 Кбит/с',
      'AC3, 2 ch, 384 Кбит/с',
      'Дублированный (неофициальный) (HDRezka Studio)'
    ];
    const cleaned = cleanAndDeduplicateVoices(raw);
    expect(cleaned).toEqual([
      'Дублированный (Cinema Tone Production)',
      'Дублированный (HDRezka Studio)'
    ]);
  });
});
