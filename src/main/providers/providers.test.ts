import { describe, expect, it, vi } from 'vitest';
import iconv from 'iconv-lite';
import { encodeWin1251, ProviderError } from './provider';
import { MegapeerProvider } from './megapeer';
import { NnmClubProvider } from './nnmclub';
import { RutrackerProvider } from './rutracker';
import { TorrentKinoProvider } from './torrentkino';

describe('encodeWin1251', () => {
  it('кодирует кириллические символы в win1251 hex-последовательность для URL', () => {
    const encoded = encodeWin1251('Интерстеллар');
    expect(encoded).toBe('%C8%ED%F2%E5%F0%F1%F2%E5%EB%EB%E0%F0');
  });

  it('сохраняет латинские символы и цифры без изменений', () => {
    expect(encodeWin1251('Avatar 2024')).toBe('Avatar%202024');
  });
});

describe('RutrackerProvider', () => {
  it('выбрасывает ProviderError с сообщением об авторизации, если пользователь не авторизован', async () => {
    const provider = new RutrackerProvider(() => ({ authorized: false }));
    await expect(
      provider.search({
        query: 'Интерстеллар',
        page: 0,
        signal: new AbortController().signal,
        customStudios: [],
        qualityAliases: []
      })
    ).rejects.toThrow(ProviderError);
  });

  it('парсит раздачи из HTML таблицы tor-tbl, если пользователь авторизован', async () => {
    const sampleHtml = `
      <table id="tor-tbl">
        <tbody>
          <tr class="tCenter hl-tr">
            <td class="row1"></td>
            <td class="f-name"><a href="viewforum.php?f=7">Зарубежное кино</a></td>
            <td class="t-title">
              <a class="tt-text" data-topic_id="555123" href="viewtopic.php?t=555123"><b>Интерстеллар / Interstellar (2014) BDRip 1080p | Dub</b></a>
            </td>
            <td class="tor-size" data-ts_text="10737418240">
              <a href="dl.php?t=555123">10 GB</a>
            </td>
            <td class="seedmed" data-ts_text="45"><b>45</b></td>
            <td class="leechmed" data-ts_text="3">3</td>
            <td data-ts_text="1700000000"><p>15-Ноя-23</p></td>
          </tr>
        </tbody>
      </table>
    `;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => iconv.encode(sampleHtml, 'win1251')
    });

    const provider = new RutrackerProvider(
      () => ({ authorized: true, cookie: 'bb_data=123' }),
      () => mockFetch as never
    );

    const results = await provider.search({
      query: 'Интерстеллар',
      page: 0,
      signal: new AbortController().signal,
      customStudios: [],
      qualityAliases: []
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Интерстеллар');
    expect(results[0].providerId).toBe('rutracker');
    expect(results[0].providerItemId).toBe('555123');
    expect(results[0].seeds).toBe(45);
    expect(results[0].leeches).toBe(3);
    expect(results[0].sizeBytes).toBe(10737418240);
    expect(results[0].torrentUrl).toBe('https://rutracker.org/forum/dl.php?t=555123');
    expect(results[0].pageUrl).toBe('https://rutracker.org/forum/viewtopic.php?t=555123');
  });
});

describe('MegapeerProvider', () => {
  it('парсит раздачи из HTML таблицы MegaPeer', async () => {
    const sampleHtml = `
      <table><tr><td>Новости</td></tr></table>
      <table><tr><td>Шапка</td></tr></table>
      <table>
        <tbody>
          <tr>
            <td>26 Сен 26</td>
            <td colspan="2">
              <a href="/download/213716"><img src="/pic/d_small.gif" /></a>
              <a href="/torrent/213716/avatar-plamya-i-pepel" class="url">Аватар: Пламя и пепел (2025) HDRip | D</a>
            </td>
            <td align="right">3.91 GB</td>
            <td align="center"><img src="/pic/seed.gif" /> <font color="#008000">15</font> <img src="/pic/leech.gif" /> <font color="#8b0000">2</font></td>
          </tr>
        </tbody>
      </table>
    `;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => iconv.encode(sampleHtml, 'win1251')
    }) as never;

    try {
      const provider = new MegapeerProvider();
      const results = await provider.search({
        query: 'Аватар',
        page: 0,
        signal: new AbortController().signal,
        customStudios: [],
        qualityAliases: []
      });

      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('megapeer');
      expect(results[0].providerItemId).toBe('213716');
      expect(results[0].title).toBe('Аватар: Пламя и пепел');
      expect(results[0].seeds).toBe(15);
      expect(results[0].leeches).toBe(2);
      expect(results[0].torrentUrl).toBe('https://megapeer.vip/download/213716');
      expect(results[0].pageUrl).toBe('https://megapeer.vip/torrent/213716/avatar-plamya-i-pepel');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('NnmClubProvider', () => {
  it('отправляет POST запрос на tracker.php и парсит раздачи', async () => {
    const sampleHtml = `
      <table class="forumline"><tr><td>Заголовок</td></tr></table>
      <table class="forumline">
        <tbody>
          <tr>
            <td class="genmed"><a href="viewtopic.php?t=1883291"><b>Маска / The Mask (1994) BDRip [H.264/720p]</b></a></td>
            <td class="gensmall"><a href="download.php?id=12345">DL</a></td>
            <td class="gensmall">16 GB</td>
            <td class="gensmall">1700000000</td>
            <td class="seedmed"><b>25</b></td>
            <td class="leechmed">2</td>
          </tr>
        </tbody>
      </table>
    `;

    const originalFetch = global.fetch;
    let sentMethod = '';
    let sentBody = '';
    global.fetch = vi.fn().mockImplementation((url, init) => {
      sentMethod = init?.method;
      sentBody = init?.body;
      return Promise.resolve({
        ok: true,
        arrayBuffer: async () => iconv.encode(sampleHtml, 'win1251')
      });
    }) as never;

    try {
      const provider = new NnmClubProvider();
      expect(provider.name).toBe('NNM');
      const results = await provider.search({
        query: 'Маска',
        page: 0,
        signal: new AbortController().signal,
        customStudios: [],
        qualityAliases: []
      });

      expect(sentMethod).toBe('POST');
      expect(sentBody).toContain('nm=%CC%E0%F1%EA%E0');
      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('nnmclub');
      expect(results[0].title).toBe('Маска');
      expect(results[0].seeds).toBe(25);
      expect(results[0].leeches).toBe(2);
      expect(results[0].pageUrl).toBe('https://nnmclub.to/forum/viewtopic.php?t=1883291');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('TorrentKinoProvider', () => {
  it('ищет фильмы через /api/search и парсит раздачи со страницы фильма', async () => {
    const searchResponse = {
      results: [
        {
          kinopoiskId: '301',
          slug: 'matritsa-1999',
          title: 'Матрица',
          originalTitle: 'The Matrix',
          year: 1999,
          contentType: 'movie'
        }
      ]
    };

    const filmPageHtml = `
      <!DOCTYPE html>
      <html>
      <head></head>
      <body>
        <script>
          self.__next_f.push([1, "{\\"id\\":19623416,\\"quality\\":\\"4K\\",\\"qualityLabel\\":\\"WEB-DL 2160p HDR\\",\\"size\\":\\"18.45 ГБ\\",\\"seeds\\":401,\\"peers\\":34,\\"translation\\":\\"Дублированный\\",\\"seasonStart\\":null,\\"seasonEnd\\":null,\\"episodeStart\\":null,\\"episodeEnd\\":null,\\"episodesTotal\\":null,\\"sortedStudios\\":[\\"Мосфильм\\"],\\"torrentPath\\":\\"/api/torrents/19623416?t=123\\"}"]);
        </script>
      </body>
      </html>
    `;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/search')) {
        return Promise.resolve({
          ok: true,
          json: async () => searchResponse
        });
      }
      return Promise.resolve({
        ok: true,
        arrayBuffer: async () => Buffer.from(filmPageHtml, 'utf8')
      });
    }) as never;

    try {
      const provider = new TorrentKinoProvider();
      const results = await provider.search({
        query: 'Матрица',
        page: 0,
        signal: new AbortController().signal,
        customStudios: [],
        qualityAliases: []
      });

      expect(results).toHaveLength(1);
      expect(results[0].providerId).toBe('torrentkino');
      expect(results[0].providerName).toBe('TorrentKino');
      expect(results[0].title).toBe('Матрица');
      expect(results[0].alternativeTitles).toContain('The Matrix');
      expect(results[0].year).toBe(1999);
      expect(results[0].resolution).toBe('2160p');
      expect(results[0].dynamicRange).toBe('hdr');
      expect(results[0].seeds).toBe(401);
      expect(results[0].leeches).toBe(34);
      expect(results[0].pageUrl).toBe('https://torrentkino.org/films/matritsa-1999#torrent-19623416');
      expect(results[0].torrentUrl).toBe('https://torrentkino.org/api/torrents/19623416?t=123');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

