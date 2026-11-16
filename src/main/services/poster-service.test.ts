import { describe, expect, it } from 'vitest';
import { titlesMatch, PosterService } from './poster-service';

describe('titlesMatch', () => {
  it('correctly matches exact or close titles', () => {
    expect(titlesMatch('Звёзды в джунглях', 'Звёзды в джунглях')).toBe(true);
    expect(titlesMatch('Звёзды в джунглях', 'Звёзды в джунглях 3 сезон')).toBe(true);
    expect(titlesMatch('Breaking Bad', 'Во все тяжкие', 'Breaking Bad')).toBe(true);
    expect(titlesMatch('Интерстеллар', 'Интерстеллар')).toBe(true);
  });

  it('rejects conflicting titles', () => {
    // Crucial bug reproduction: "Звёзды в джунглях" vs "Звёзды в Сибири"
    expect(titlesMatch('Звёзды в джунглях', 'Звёзды в Сибири')).toBe(false);
    expect(titlesMatch('Матрица', 'Метро')).toBe(false);
    expect(titlesMatch('Терминатор', 'Гладиатор')).toBe(false);
    // Comedy Club vs Palestine Comedy Club must NEVER match
    expect(titlesMatch('Comedy Club', 'Palestine Comedy Club')).toBe(false);
    expect(titlesMatch('Камеди Клаб', 'Palestine Comedy Club')).toBe(false);
    expect(titlesMatch('Comedy Club', 'Камеди Клаб')).toBe(true);
  });
});

describe('PosterService extraction', () => {
  it('extracts image from MegaPeer description html', async () => {
    const service = new PosterService();
    const html = `
      <td id="descr">
        <a href="https://fastpic.org"><img src="https://i126.fastpic.org/big/2025/0929/47/poster.jpg" /></a>
      </td>
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'https://megapeer.vip/torrent/123');
    expect(extracted).toBe('https://i126.fastpic.org/big/2025/0929/47/poster.jpg');
  });

  it('extracts image from RuTor details html', async () => {
    const service = new PosterService();
    const html = `
      <table id="details">
        <tr><td><img src="https://image.tmdb.org/t/p/w500/test.jpg" /></td></tr>
      </table>
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'http://rutor.info/torrent/456');
    expect(extracted).toBe('https://image.tmdb.org/t/p/w500/test.jpg');
  });

  it('extracts right-aligned img.postImg from RuTracker (topic 6919959)', async () => {
    const service = new PosterService();
    const html = `
      <div class="post_body" id="p-89677436">
        <span style="font-size: 24px;">Звёзды в джунглях. Карибский сезон 3</span><br>
        <img class="postImg postImgAligned img-right" alt="pic" src="https://i126.fastpic.org/big/2025/0929/47/2f0e7293c9dded242de4b5cf2e902347.jpg">
        <span class="post-b">Год выпуска</span>: 2026
        <div class="sp-wrap">
          <var class="postImg" title="https://i128.fastpic.org/thumb/2026/1008/c5/thumb.jpeg"></var>
        </div>
      </div>
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'https://rutracker.org/forum/viewtopic.php?t=6919959');
    expect(extracted).toBe('https://i126.fastpic.org/big/2025/0929/47/2f0e7293c9dded242de4b5cf2e902347.jpg');
  });

  it('extracts poster from NNMClub and never picks rss.png', async () => {
    const service = new PosterService();
    const html = `
      <div class="postbody">
        <span style="font-weight: bold">Джуманджи: Новый уровень / Jumanji: The Next Level (2019) BDRip</span>
        <hr />
        <var class="postImg postImgAligned img-right" title="https://nnmstatic.win/forum/image.php?link=http://funkyimg.com/i/33SWm.jpg"></var>
        <meta property="og:image" content="http://funkyimg.com/i/33SWm.jpg" />
      </div>
      <img src="https://nnmstatic.win/forum/templates/smartBlue/images/rss.png" alt="rss" />
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'https://nnmclub.to/forum/viewtopic.php?t=1473669');
    expect(extracted).toBe('http://funkyimg.com/i/33SWm.jpg');
    expect(extracted).not.toContain('rss.png');
  });

  it('filters out forum icons in generic fallback', async () => {
    const service = new PosterService();
    const html = `
      <div>
        <img src="https://nnmstatic.win/forum/templates/smartBlue/images/rss.png" alt="rss" />
        <img src="https://nnmstatic.win/forum/images/spacer.gif" />
        <img src="https://nnmstatic.win/forum/images/platinum.gif" />
      </div>
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'https://unknown.com');
    expect(extracted).toBeNull();
  });

  it('extracts Kinopoisk poster from html containing kinopoisk.ru link', async () => {
    const service = new PosterService();
    const html = `
      <div class="post_body">
        <a href="https://www.kinopoisk.ru/film/258687/">Кинопоиск</a>
        <img src="https://example.com/poster.jpg" />
      </div>
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'https://rutracker.org/forum/viewtopic.php?t=123');
    expect(extracted).toBe('https://st.kp.yandex.net/images/film_iphone/iphone360_258687.jpg');
  });

  it('uses ruTrackerPageLoader when resolving RuTracker pageUrl', async () => {
    const service = new PosterService();
    service.setRuTrackerPageLoader(async (_url) => {
      return `
        <div class="post_body">
          <img class="postImg postImgAligned img-right" alt="pic" src="https://i126.fastpic.org/big/2025/0929/47/2f0e7293c9dded242de4b5cf2e902347.jpg">
        </div>
      `;
    });
    const url = await service.resolvePoster('Локальное шоу редкий релиз', 2026, 'https://rutracker.org/forum/viewtopic.php?t=6919959');
    expect(url).toBe('https://i126.fastpic.org/big/2025/0929/47/2f0e7293c9dded242de4b5cf2e902347.jpg');
  });

  it('correctly picks series poster instead of movie poster for Джуманджи 1996', async () => {
    const service = new PosterService();
    // For series 1996, it should resolve to dzhumandzhi-1996.webp, NOT 1995 movie!
    const seriesPoster = await service.resolvePoster('Джуманджи', 1996, 'https://rutor.info/torrent/12345', 'series');
    expect(seriesPoster).toContain('dzhumandzhi-1996.webp');

    // For movie 1995, it should resolve to dzhumandzhi-1995.webp
    const moviePoster = await service.resolvePoster('Джуманджи', 1995, 'https://rutor.info/torrent/54321', 'movie');
    expect(moviePoster).toContain('dzhumandzhi-1995.webp');
  });

  it('shares resolved poster across other release cards for the same title', async () => {
    const service = new PosterService();
    // 1. First card (e.g. MegaPeer) resolves poster from its page HTML
    const card1Poster = await service.resolvePoster(
      'Звёзды в джунглях',
      2024,
      'https://megapeer.vip/torrent/999'
    );
    // Since megapeer 999 doesn't really exist, it should fallback to IMDb or if simulated:
    // Let's test explicit title sharing:
    // @ts-expect-error test private cache
    service.titlePosterCache.set('звёзды в джунглях:2024:', 'https://cdn.example.com/stars_poster.jpg');

    // 2. Second card (e.g. RuTracker or NNM) requests poster for same title
    const card2Poster = await service.resolvePoster(
      'Звёзды в джунглях',
      2024,
      'https://rutracker.org/forum/viewtopic.php?t=1111'
    );
    expect(card2Poster).toBe('https://cdn.example.com/stars_poster.jpg');
  });

  it('marks Kinopoisk rating as not formed when rating is 0 but votes exist', async () => {
    const service = new PosterService();
    // Mock fetch for rating.kinopoisk.ru/14171220.xml
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('rating.kinopoisk.ru/14171220.xml')) {
        return new Response(
          '<?xml version="1.0" encoding="WINDOWS-1251"?><rating><kp_rating num_vote="81">0</kp_rating><imdb_rating num_vote="29">6.8</imdb_rating></rating>',
          { status: 200 }
        );
      }
      return origFetch(url);
    }) as typeof fetch;

    try {
      const ratings = await service.fetchRatingsByKpId('14171220', 'test_key');
      expect(ratings?.kp).toBe('Не сформирован');
      expect(ratings?.kpNotFormed).toBe(true);
      expect(ratings?.kpVotes).toBe('81');
      expect(ratings?.imdb).toBe('6.8');
      expect(ratings?.imdbVotes).toBe('29');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('matches Russian reality show with Caribbean season subtitle to English transliteration', () => {
    expect(titlesMatch('Звёзды в джунглях', 'Zvyozdy v Dzhunglyakh')).toBe(true);
  });

  it('ignores dead radikal.ru and nnmstatic.win image URLs', () => {
    const service = new PosterService();
    const html = `
      <div class="postbody">
        <var class="postImg" title="https://nnmstatic.win/forum/image.php?link=https://d.radikal.ru/d42/1912/0c/ea9393bafb18.jpg"></var>
      </div>
    `;
    // @ts-expect-error accessing private method for unit test
    const extracted = service.extractPosterFromHtml(html, 'https://nnmclub.to/forum/viewtopic.php?t=123');
    expect(extracted).toBeNull();
  });

  it('resolves correct official poster for Comedy Club and never Palestine Comedy Club', async () => {
    const service = new PosterService();
    const poster = await service.resolvePoster('Comedy Club', 2025, 'https://rutracker.org/forum/viewtopic.php?t=6654836', 'series');
    expect(poster).toBe('https://image.tmdb.org/t/p/w500/tPIbd7JZVxSWNjcJQYEvPu3qo5z.jpg');
    expect(poster).not.toContain('BODJjOTcwM2EtYmE5MS00ZDcxLTliMWEtOGJlNjU3NThlYjRh');
  });

  it('resolves poster for Битва экстрасенсов across seasons', async () => {
    const service = new PosterService();
    const poster = await service.resolvePoster('Битва экстрасенсов', 2018, 'https://rutracker.org/forum/viewtopic.php?t=12345', 'series');
    expect(poster).toBe('https://image.tmdb.org/t/p/w500/yyuXEH1OP2QtwJFOm2wIMsEc03B.jpg');
  });
});
