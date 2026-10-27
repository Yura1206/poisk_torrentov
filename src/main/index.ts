import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { LocalStorage } from './services/storage';
import { SearchEngine } from './services/search-engine';
import { appDetector } from './services/app-detector';
import { posterService } from './services/poster-service';
import { RutorProvider } from './providers/rutor';
import { NnmClubProvider } from './providers/nnmclub';
import { MegapeerProvider } from './providers/megapeer';
import { TorrentKinoProvider } from './providers/torrentkino';
import { RutrackerProvider } from './providers/rutracker';
import { APP_USER_AGENT, fetchPage, mapConcurrent, ProviderError } from './providers/provider';
import { cleanAndDeduplicateVoices, parseTopicHtml } from './lib/metadata';
import { parseAndNormalizeRuTrackerCookies } from './lib/cookies';
import type { AppSettings, SearchRequest, TorrentResult } from '../shared/types';

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | undefined;
let storage: LocalStorage;
let engine: SearchEngine;

function terminateApp(): void {
  if (ruTrackerWorker && !ruTrackerWorker.isDestroyed()) {
    try {
      ruTrackerWorker.destroy();
    } catch {
      // ignore
    }
    ruTrackerWorker = undefined;
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        // ignore
      }
    }
  }

  app.quit();

  const forceExitTimer = setTimeout(() => {
    process.exit(0);
  }, 300);
  forceExitTimer.unref();
}

const isHttpUrl = (value: string): boolean => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};
const isMagnet = (value: string): boolean => /^magnet:\?xt=urn:btih:[a-z0-9]{32,64}/iu.test(value);

async function createWindow(): Promise<void> {
  const saved = storage.windowBounds;
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 900,
    x: saved?.x,
    y: saved?.y,
    minWidth: 1060,
    minHeight: 680,
    backgroundColor: '#0e0e0e',
    show: false,
    title: 'Поисковик торрентов',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (saved?.maximized || !saved) mainWindow?.maximize();
  });
  mainWindow.on('close', () => {
    if (!mainWindow) return;
    try {
      const bounds = mainWindow.getBounds();
      void storage.saveWindow({ ...bounds, maximized: mainWindow.isMaximized() });
    } catch {
      // ignore
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
    terminateApp();
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) await mainWindow.loadURL(devServerUrl);
  else await mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
}

function registerIpc(): void {
  ipcMain.handle('search:run', async (_event, request: SearchRequest) => {
    return engine.search({
      ...request,
      query: request.query.replace(/\s+/gu, ' ').trim().slice(0, 150)
    }, (progress) => {
      mainWindow?.webContents.send('search:stream', progress);
    });
  });
  ipcMain.handle('search:cancel', (_event, requestId: string) => engine.cancel(requestId));
  ipcMain.handle('settings:get', () => storage.settings);
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => storage.saveSettings(settings));
  ipcMain.handle('history:get', () => storage.history);
  ipcMain.handle('history:remove', async (_event, query: string) => storage.removeHistoryItem(query));
  ipcMain.handle('history:clear', () => storage.clearHistory());
  ipcMain.handle('providers:check', () => engine.check());
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:openDataFolder', async () => { await shell.openPath(app.getPath('userData')); });
  ipcMain.handle('external:open', async (_event, url: string) => openExternal(url));
  ipcMain.handle('magnet:copy', (_event, magnet: string) => {
    if (!isMagnet(magnet)) return { ok: false, error: 'Некорректная magnet-ссылка' };
    clipboard.writeText(magnet);
    return { ok: true };
  });
  ipcMain.handle('magnet:open', async (_event, magnet: string) => {
    if (!isMagnet(magnet)) return { ok: false, error: 'Некорректная magnet-ссылка' };
    try { await shell.openExternal(magnet); return { ok: true }; } catch { return { ok: false, error: 'Не удалось передать ссылку торрент-клиенту' }; }
  });
  ipcMain.handle('magnet:resolve', async (_event, pageUrl: string) => resolveMagnetFromPage(pageUrl));
  ipcMain.handle('topic:resolveDetails', async (_event, pageUrl: string) => resolveTopicDetails(pageUrl));
  ipcMain.handle('torrent:download', (_event, url: string, title: string) => downloadTorrent(url, title));

  ipcMain.handle('rutracker:loginWindow', () => openRuTrackerLoginWindow());
  ipcMain.handle('rutracker:saveAuth', (_event, auth: { cookie?: string; username?: string }) => saveRuTrackerAuth(auth));
  ipcMain.handle('rutracker:clearAuth', () => clearRuTrackerAuth());
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('magnet:getApps', async () => appDetector.detectApps());
  ipcMain.handle('magnet:openWith', async (_event, magnet: string, appId: string, title?: string, saveAsDefault?: boolean) => {
    if (saveAsDefault && appId) {
      await storage.saveSettings({ ...storage.settings, magnetAction: appId });
    }
    return appDetector.openMagnetWith(magnet, appId, title);
  });
  posterService.setRuTrackerPageLoader((url: string, signal?: AbortSignal) =>
    fetchRuTrackerPage(url, signal, 8000)
  );
  ipcMain.handle('poster:resolve', async (_event, title: string, year?: number, pageUrl?: string, contentType?: string) =>
    posterService.resolvePoster(title, year, pageUrl, contentType)
  );
}

async function syncRuTrackerCookies(cookieStr: string, sess: Electron.Session): Promise<void> {
  const { cookieHeader } = parseAndNormalizeRuTrackerCookies(cookieStr);
  const pairs = cookieHeader.split(';').map((p) => p.trim()).filter(Boolean);
  const expirationDate = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx > 0) {
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      for (const d of ['rutracker.org', 'rutracker.net', 'rutracker.nl']) {
        try {
          await sess.cookies.set({
            url: `https://${d}`,
            domain: `.${d}`,
            name,
            value,
            path: '/',
            expirationDate
          });
        } catch {
          // ignore
        }
      }
    }
  }
}

let ruTrackerWorker: BrowserWindow | undefined;

function getRuTrackerWorker(sess: Electron.Session): BrowserWindow {
  if (!ruTrackerWorker || ruTrackerWorker.isDestroyed()) {
    ruTrackerWorker = new BrowserWindow({
      show: true,
      skipTaskbar: true,
      x: -25000,
      y: -25000,
      width: 1024,
      height: 768,
      webPreferences: {
        session: sess,
        sandbox: true,
        images: true,
        backgroundThrottling: false
      }
    });
  }
  return ruTrackerWorker;
}

async function fetchRuTrackerPage(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15000
): Promise<string> {
  const rutrackerSession = session.fromPartition('persist:rutracker');
  if (storage.rutrackerAuth?.cookie) {
    await syncRuTrackerCookies(storage.rutrackerAuth.cookie, rutrackerSession);
  }

  const win = getRuTrackerWorker(rutrackerSession);
  const start = Date.now();

  await win.loadURL(url);

  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('Поиск отменён');
    const title = win.getTitle();
    const isChallenging =
      title.toLowerCase().includes('момент') ||
      title.toLowerCase().includes('moment') ||
      title.toLowerCase().includes('cloudflare');
    if (!isChallenging) {
      try {
        const cookies = await rutrackerSession.cookies.get({});
        const cookieString = cookies
          .filter((c) => (c.domain || '').includes('rutracker'))
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
        if (cookieString && storage.rutrackerAuth?.authorized && cookieString !== storage.rutrackerAuth.cookie) {
          await storage.setRuTrackerAuth({
            ...storage.rutrackerAuth,
            cookie: cookieString
          });
        }
      } catch {
        // ignore
      }
      return await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  const finalTitle = win.getTitle();
  if (
    finalTitle.toLowerCase().includes('момент') ||
    finalTitle.toLowerCase().includes('moment') ||
    finalTitle.toLowerCase().includes('cloudflare')
  ) {
    throw new ProviderError(
      'RuTracker Cloudflare verification required',
      'RuTracker требует подтверждения Cloudflare («Один момент...»). Откройте настройки и выполните повторный вход.'
    );
  }

  return await win.webContents.executeJavaScript('document.documentElement.outerHTML');
}

async function openExternal(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!isHttpUrl(url)) return { ok: false, error: 'Можно открыть только ссылку HTTP/HTTPS' };
  try { await shell.openExternal(url); return { ok: true }; } catch { return { ok: false, error: 'Не удалось открыть ссылку' }; }
}

const magnetCache = new Map<string, string>();
const topicDetailsCache = new Map<string, import('./lib/metadata').TopicDetails>();

async function resolveTopicDetails(pageUrl: string): Promise<{ ok: boolean; details?: import('./lib/metadata').TopicDetails; error?: string }> {
  if (!isHttpUrl(pageUrl)) return { ok: false, error: 'Некорректная ссылка на страницу раздачи' };
  if (topicDetailsCache.has(pageUrl)) {
    return { ok: true, details: topicDetailsCache.get(pageUrl) };
  }
  try {
    if (pageUrl.includes('torrentkino.org')) {
      const torrentId = pageUrl.match(/#torrent-(\d+)/)?.[1];
      if (torrentId) {
        const res = await fetch(`https://torrentkino.org/api/sources/${torrentId}`, {
          headers: {
            'User-Agent': APP_USER_AGENT,
            'Referer': pageUrl.split('#')[0]
          },
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const data = (await res.json()) as { video?: string; audio?: string; magnetUrl?: string };
          const details: import('./lib/metadata').TopicDetails = {
            magnetUrl: data.magnetUrl,
            translations: []
          };
          topicDetailsCache.set(pageUrl, details);
          if (data.magnetUrl) {
            magnetCache.set(pageUrl, data.magnetUrl);
          }
          return { ok: true, details };
        }
      }
    }

    const isRuTracker = pageUrl.includes('rutracker.org');
    let html: string;
    if (isRuTracker) {
      html = await fetchRuTrackerPage(pageUrl, AbortSignal.timeout(10000));
    } else {
      html = await fetchPage(pageUrl, AbortSignal.timeout(6000), 'win1251');
    }
    const details = parseTopicHtml(html, storage.settings.customStudios);
    topicDetailsCache.set(pageUrl, details);
    if (details.magnetUrl) {
      magnetCache.set(pageUrl, details.magnetUrl);
    }
    return { ok: true, details };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Не удалось загрузить страницу раздачи' };
  }
}

async function resolveMagnetFromPage(pageUrl: string): Promise<{ ok: boolean; magnet?: string; error?: string }> {
  if (magnetCache.has(pageUrl)) {
    return { ok: true, magnet: magnetCache.get(pageUrl) };
  }
  if (pageUrl.includes('torrentkino.org')) {
    const torrentId = pageUrl.match(/#torrent-(\d+)/)?.[1];
    if (torrentId) {
      try {
        const res = await fetch(`https://torrentkino.org/api/sources/${torrentId}`, {
          headers: {
            'User-Agent': APP_USER_AGENT,
            'Referer': pageUrl.split('#')[0]
          },
          signal: AbortSignal.timeout(6000)
        });
        if (res.ok) {
          const data = (await res.json()) as { magnetUrl?: string };
          if (data?.magnetUrl) {
            magnetCache.set(pageUrl, data.magnetUrl);
            return { ok: true, magnet: data.magnetUrl };
          }
        }
      } catch (_) {}
    }
  }
  const res = await resolveTopicDetails(pageUrl);
  if (res.ok && res.details?.magnetUrl) {
    return { ok: true, magnet: res.details.magnetUrl };
  }
  return { ok: false, error: res.error || 'Magnet-ссылка не найдена на странице раздачи' };
}

async function downloadTorrent(url: string, title: string): Promise<{ ok: boolean; error?: string }> {
  if (!isHttpUrl(url)) return { ok: false, error: 'Некорректная ссылка на торрент-файл' };
  const safeName = `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').slice(0, 120) || 'download'}.torrent`;
  const saveOptions = { title: 'Сохранить торрент-файл', defaultPath: safeName, filters: [{ name: 'Torrent', extensions: ['torrent'] }] };
  const target = mainWindow ? await dialog.showSaveDialog(mainWindow, saveOptions) : await dialog.showSaveDialog(saveOptions);
  if (target.canceled || !target.filePath) return { ok: false, error: 'Сохранение отменено' };
  try {
    const isRuTracker = url.includes('rutracker.org');
    const rutrackerSession = session.fromPartition('persist:rutracker');
    const headers: Record<string, string> = {};
    if (!isRuTracker) {
      headers['User-Agent'] = APP_USER_AGENT;
    }
    if (isRuTracker && storage.rutrackerAuth?.cookie) {
      headers.Cookie = storage.rutrackerAuth.cookie;
    }
    const fetchFn = isRuTracker ? rutrackerSession.fetch.bind(rutrackerSession) : fetch;
    const response = await fetchFn(url, { headers, signal: AbortSignal.timeout(20_000) });
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (!response.ok || (contentLength && contentLength > 20 * 1024 * 1024)) throw new Error('Недопустимый ответ сервера');
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > 20 * 1024 * 1024 || data[0] !== 0x64) throw new Error('Сервер вернул не торрент-файл');
    await writeFile(target.filePath, data);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Не удалось загрузить торрент-файл' };
  }
}

/** Helper: returns true if the cookie indicates a logged-in RuTracker session. */
function isRuTrackerLoginCookie(c: Electron.Cookie): boolean {
  if (c.name === 'bb_data' && c.value && c.value.length > 5) return true;
  if (c.name === 'bb_session' && c.value && c.value.length > 10) return true;
  return false;
}

async function openRuTrackerLoginWindow(): Promise<{ ok: boolean; username?: string; error?: string }> {
  const rutrackerSession = session.fromPartition('persist:rutracker');
  return new Promise((resolve) => {
    let resolved = false;
    let pollTimer: NodeJS.Timeout | undefined;

    const authWin = new BrowserWindow({
      width: 1040,
      height: 780,
      center: true,
      title: 'Вход в RuTracker.org',
      icon: path.join(__dirname, '../../build/icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        session: rutrackerSession,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false
      }
    });

    const cleanup = () => {
      rutrackerSession.cookies.removeListener('changed', cookieListener);
      if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
    };

    const finishSuccess = async (username?: string, foundCookies?: Electron.Cookie[]) => {
      if (resolved) return;
      resolved = true;
      cleanup();

      if (ruTrackerWorker && !ruTrackerWorker.isDestroyed()) {
        ruTrackerWorker.destroy();
        ruTrackerWorker = undefined;
      }

      let detectedUser = username;
      if (!detectedUser && !authWin.isDestroyed()) {
        try {
          detectedUser = await authWin.webContents.executeJavaScript(
            `document.querySelector('#logged-in-username')?.innerText || document.querySelector('a[href*="profile.php?mode=viewprofile"]')?.innerText || undefined`
          );
        } catch {
          // ignore
        }
      }

      const allCookies = foundCookies || (await rutrackerSession.cookies.get({}));
      const cookieString = allCookies
        .filter((c) => (c.domain || '').includes('rutracker'))
        .map((c) => `${c.name}=${c.value}`)
        .join('; ');

      const resolvedUser = detectedUser?.trim() || 'Пользователь RuTracker';
      await storage.setRuTrackerAuth({
        authorized: true,
        cookie: cookieString,
        username: resolvedUser
      });

      if (!authWin.isDestroyed()) {
        authWin.close();
      }
      resolve({ ok: true, username: resolvedUser });
    };

    const checkAndFinish = async () => {
      if (resolved || authWin.isDestroyed()) return;
      try {
        const cookies = await rutrackerSession.cookies.get({});
        const hasLoginCookie = cookies.some((c) => isRuTrackerLoginCookie(c));
        const currentUrl = authWin.webContents.getURL() || '';
        const notOnLoginPage = !currentUrl.includes('login.php') && currentUrl.includes('rutracker');

        let domUser: string | undefined;
        try {
          domUser = await authWin.webContents.executeJavaScript(`(() => {
            const el = document.querySelector('#logged-in-username') || document.querySelector('a[href*="profile.php?mode=viewprofile"]');
            return el?.innerText?.trim() || null;
          })()`);
        } catch {
          // ignore
        }

        if (domUser || (hasLoginCookie && notOnLoginPage)) {
          await finishSuccess(domUser || undefined, cookies);
        }
      } catch {
        // ignore
      }
    };

    const cookieListener = (_event: Electron.Event, cookie: Electron.Cookie, _cause: string, removed: boolean) => {
      if (!removed && isRuTrackerLoginCookie(cookie)) {
        void checkAndFinish();
      }
    };

    rutrackerSession.cookies.on('changed', cookieListener);
    authWin.webContents.on('did-finish-load', () => void checkAndFinish());
    authWin.webContents.on('did-navigate', () => void checkAndFinish());
    pollTimer = setInterval(() => void checkAndFinish(), 1000);

    // On window close: check cookies one last time
    authWin.on('close', () => {
      cleanup();
      if (!resolved) {
        rutrackerSession.cookies.get({}).then(async (cookies) => {
          const found = cookies.find((c) => isRuTrackerLoginCookie(c));
          if (found) {
            await finishSuccess(undefined, cookies);
          } else {
            resolved = true;
            resolve({ ok: false, error: 'Окно закрыто. Авторизация не была завершена.' });
          }
        }).catch(() => {
          resolved = true;
          resolve({ ok: false, error: 'Окно закрыто.' });
        });
      }
    });

    void authWin.loadURL('https://rutracker.org/forum/login.php');
  });
}

async function saveRuTrackerAuth(auth: { cookie?: string; username?: string }): Promise<{ ok: boolean; username?: string; error?: string }> {
  if (!auth.cookie?.trim()) {
    return { ok: false, error: 'Укажите строку Cookie' };
  }
  const parsed = parseAndNormalizeRuTrackerCookies(auth.cookie);
  if (!parsed.cookieHeader) {
    return { ok: false, error: 'Не удалось распознать формат Cookie.' };
  }

  const rutrackerSession = session.fromPartition('persist:rutracker');
  await syncRuTrackerCookies(parsed.cookieHeader, rutrackerSession);

  let detectedUser = auth.username?.trim();
  try {
    const resp = await rutrackerSession.fetch('https://rutracker.org/forum/index.php', {
      headers: {
        Cookie: parsed.cookieHeader
      },
      signal: AbortSignal.timeout(8000)
    });
    if (resp.ok) {
      const html = await resp.text();
      const $ = cheerio.load(html);
      const userEl = $('#logged-in-username, a[href*="profile.php?mode=viewprofile"], #top-nav a.bold').first();
      const name = userEl.text().trim();
      if (name) {
        detectedUser = name;
      }
    }
  } catch {
    // ignore — cookies are saved anyway
  }

  const resolvedUser = detectedUser || 'Пользователь RuTracker';

  await storage.setRuTrackerAuth({
    authorized: true,
    cookie: parsed.cookieHeader,
    username: resolvedUser
  });

  return { ok: true, username: resolvedUser };
}

async function clearRuTrackerAuth(): Promise<void> {
  const rutrackerSession = session.fromPartition('persist:rutracker');
  if (ruTrackerWorker && !ruTrackerWorker.isDestroyed()) {
    ruTrackerWorker.destroy();
    ruTrackerWorker = undefined;
  }
  try {
    await rutrackerSession.clearStorageData({ storages: ['cookies'] });
  } catch {
    // ignore
  }
  await storage.clearRuTrackerAuth();
}

app.whenReady().then(async () => {
  app.setAppUserModelId('ru.torrentnavigator.app');
  Menu.setApplicationMenu(null);
  storage = new LocalStorage(app.getPath('userData'));
  await storage.load();

  const rutrackerSession = session.fromPartition('persist:rutracker');

  if (storage.rutrackerAuth?.cookie) {
    await syncRuTrackerCookies(storage.rutrackerAuth.cookie, rutrackerSession);
  }

  engine = new SearchEngine([
    new RutorProvider(),
    new NnmClubProvider(),
    new MegapeerProvider(),
    new TorrentKinoProvider(),
    new RutrackerProvider(
      () => storage.rutrackerAuth,
      () => (url: string, init?: RequestInit) => rutrackerSession.fetch(url, init),
      (url: string, signal?: AbortSignal) => fetchRuTrackerPage(url, signal)
    )
  ], () => storage.settings, (query) => { void storage.addHistory(query); });

  registerIpc();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
});

app.on('before-quit', () => {
  terminateApp();
});

app.on('will-quit', () => {
  terminateApp();
});

app.on('window-all-closed', () => {
  terminateApp();
});
