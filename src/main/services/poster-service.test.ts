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
    expect(extracted).toBe('https://nnmstatic.win/forum/image.php?link=http://funkyimg.com/i/33SWm.jpg');
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

  it('uses ruTrackerPageLoader when resolving RuTracker pageUrl', async () => {
    const service = new PosterService();
    service.setRuTrackerPageLoader(async (_url) => {
      return `
        <div class="post_body">
          <img class="postImg postImgAligned img-right" alt="pic" src="https://i126.fastpic.org/big/2025/0929/47/2f0e7293c9dded242de4b5cf2e902347.jpg">
        </div>
      `;
    });
    const url = await service.resolvePoster('Звёзды в джунглях', 2026, 'https://rutracker.org/forum/viewtopic.php?t=6919959');
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
});
