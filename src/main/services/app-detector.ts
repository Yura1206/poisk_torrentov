import { existsSync } from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { shell } from 'electron';
import type { DetectedApp } from '../../shared/types';

interface CandidateDefinition {
  id: string;
  name: string;
  type: 'client' | 'player';
  description: string;
  regKeys?: string[];
  relPaths: string[];
  userPaths?: string[];
}

function queryRegistry(key: string): string | null {
  try {
    const out = execSync(`reg query "${key}" /ve`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    });
    const match = out.match(/REG_SZ\s+(.*)/i);
    if (!match) return null;
    let val = match[1].trim();
    const quoted = val.match(/^"([^"]+)"/);
    if (quoted) {
      val = quoted[1];
    } else {
      const exeMatch = val.match(/^(.*\.exe)(\s.*)?$/i);
      if (exeMatch) val = exeMatch[1];
    }
    return existsSync(val) ? val : null;
  } catch {
    return null;
  }
}

function getAvailableDrives(): string[] {
  const letters = ['C', 'D', 'E', 'F', 'G', 'H', 'I'];
  const drives: string[] = [];
  for (const l of letters) {
    const root = `${l}:\\`;
    try {
      if (existsSync(root)) {
        drives.push(root);
      }
    } catch {
      // ignore inaccessible drive
    }
  }
  return drives.length > 0 ? drives : ['C:\\'];
}

const LOCAL_APPDATA = process.env['LOCALAPPDATA'] || '';
const APPDATA = process.env['APPDATA'] || '';
const USERPROFILE = process.env['USERPROFILE'] || '';

const CLIENT_CANDIDATES: CandidateDefinition[] = [
  {
    id: 'qbittorrent',
    name: 'qBittorrent',
    type: 'client',
    description: 'Быстрый торрент-клиент с открытым исходным кодом',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\qbittorrent.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\qbittorrent.exe'
    ],
    relPaths: [
      'Program Files\\qBittorrent\\qbittorrent.exe',
      'Program Files (x86)\\qBittorrent\\qbittorrent.exe',
      'qBittorrent\\qbittorrent.exe'
    ],
    userPaths: [
      path.join(LOCAL_APPDATA, 'Programs', 'qBittorrent', 'qbittorrent.exe'),
      path.join(APPDATA, 'qBittorrent', 'qbittorrent.exe')
    ]
  },
  {
    id: 'utorrent',
    name: 'uTorrent',
    type: 'client',
    description: 'Популярный торрент-клиент',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\uTorrent.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\uTorrent.exe'
    ],
    relPaths: [
      'Program Files\\uTorrent\\uTorrent.exe',
      'Program Files (x86)\\uTorrent\\uTorrent.exe',
      'uTorrent\\uTorrent.exe'
    ],
    userPaths: [
      path.join(APPDATA, 'uTorrent', 'uTorrent.exe'),
      path.join(LOCAL_APPDATA, 'uTorrent', 'uTorrent.exe'),
      path.join(LOCAL_APPDATA, 'Programs', 'uTorrent', 'uTorrent.exe')
    ]
  },
  {
    id: 'bittorrent',
    name: 'BitTorrent',
    type: 'client',
    description: 'Классический торрент-клиент',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\BitTorrent.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\BitTorrent.exe'
    ],
    relPaths: [
      'Program Files\\BitTorrent\\BitTorrent.exe',
      'Program Files (x86)\\BitTorrent\\BitTorrent.exe'
    ],
    userPaths: [
      path.join(APPDATA, 'BitTorrent', 'BitTorrent.exe'),
      path.join(LOCAL_APPDATA, 'Programs', 'BitTorrent', 'BitTorrent.exe')
    ]
  },
  {
    id: 'transmission',
    name: 'Transmission',
    type: 'client',
    description: 'Легковесный торрент-клиент',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\transmission-qt.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\transmission-qt.exe'
    ],
    relPaths: [
      'Program Files\\Transmission\\transmission-qt.exe',
      'Program Files (x86)\\Transmission\\transmission-qt.exe',
      'Transmission\\transmission-qt.exe'
    ]
  },
  {
    id: 'tixati',
    name: 'Tixati',
    type: 'client',
    description: 'Продвинутый торрент-клиент',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\tixati.exe'
    ],
    relPaths: [
      'Program Files\\Tixati\\tixati.exe',
      'Program Files (x86)\\Tixati\\tixati.exe'
    ]
  },
  {
    id: 'deluge',
    name: 'Deluge',
    type: 'client',
    description: 'Кроссплатформенный торрент-клиент',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\deluge.exe'
    ],
    relPaths: [
      'Program Files\\Deluge\\deluge.exe',
      'Program Files (x86)\\Deluge\\deluge.exe'
    ]
  }
];

const PLAYER_CANDIDATES = [
  {
    id: 'vlc',
    name: 'VLC Media Player',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\vlc.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\vlc.exe'
    ],
    relPaths: [
      'Program Files\\VideoLAN\\VLC\\vlc.exe',
      'Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
      'VideoLAN\\VLC\\vlc.exe'
    ]
  },
  {
    id: 'mpc',
    name: 'MPC-HC',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\mpc-hc64.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\mpc-hc.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\mpc-be64.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\mpc-be.exe'
    ],
    relPaths: [
      'Program Files\\MPC-HC\\mpc-hc64.exe',
      'Program Files (x86)\\MPC-HC\\mpc-hc.exe',
      'Program Files (x86)\\K-Lite Codec Pack\\MPC-HC64\\mpc-hc64.exe',
      'Program Files (x86)\\K-Lite Codec Pack\\MPC-HC\\mpc-hc.exe',
      'Program Files\\K-Lite Codec Pack\\MPC-HC64\\mpc-hc64.exe',
      'Program Files\\MPC-BE\\mpc-be64.exe',
      'Program Files (x86)\\MPC-BE\\mpc-be.exe'
    ]
  },
  {
    id: 'potplayer',
    name: 'PotPlayer',
    regKeys: [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\PotPlayer64.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\PotPlayer.exe'
    ],
    relPaths: [
      'Program Files\\DAUM\\PotPlayer\\PotPlayer64.exe',
      'Program Files (x86)\\DAUM\\PotPlayer\\PotPlayer.exe',
      'Program Files\\PotPlayer\\PotPlayer64.exe'
    ]
  }
];

const TORRSERVER_EXE_NAMES = [
  'TorrServer-windows-amd64.exe',
  'TorrServer-windows-386.exe',
  'TorrServer.exe',
  'torrserver.exe'
];

export class AppDetector {
  private cachedApps: DetectedApp[] | null = null;
  private torrServerExe: string | null = null;

  async isTorrServerRunning(): Promise<boolean> {
    try {
      const res = await fetch('http://127.0.0.1:8090/echo', { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  findTorrServerExe(): string | null {
    if (this.torrServerExe && existsSync(this.torrServerExe)) {
      return this.torrServerExe;
    }

    const drives = getAvailableDrives();

    // Check drives
    for (const drive of drives) {
      for (const name of TORRSERVER_EXE_NAMES) {
        const candidates = [
          path.join(drive, 'Program Files', 'TorrServer', name),
          path.join(drive, 'Program Files (x86)', 'TorrServer', name),
          path.join(drive, 'TorrServer', name),
          path.join(drive, name)
        ];
        for (const cand of candidates) {
          if (existsSync(cand)) {
            this.torrServerExe = cand;
            return cand;
          }
        }
      }
    }

    // Check user profile directories
    const userDirs = [
      path.join(APPDATA, 'TorrServer'),
      path.join(LOCAL_APPDATA, 'TorrServer'),
      path.join(USERPROFILE, 'TorrServer'),
      path.join(USERPROFILE, 'Downloads', 'TorrServer'),
      path.join(USERPROFILE, 'Downloads')
    ];
    for (const dir of userDirs) {
      for (const name of TORRSERVER_EXE_NAMES) {
        const cand = path.join(dir, name);
        if (existsSync(cand)) {
          this.torrServerExe = cand;
          return cand;
        }
      }
    }

    return null;
  }

  private resolveAppPath(candidate: CandidateDefinition, drives: string[]): string | null {
    // 1. Registry App Paths
    if (candidate.regKeys) {
      for (const key of candidate.regKeys) {
        const found = queryRegistry(key);
        if (found) return found;
      }
    }

    // 2. User directories
    if (candidate.userPaths) {
      for (const p of candidate.userPaths) {
        if (existsSync(p)) return p;
      }
    }

    // 3. Scan all available drives
    for (const drive of drives) {
      for (const rel of candidate.relPaths) {
        const full = path.join(drive, rel);
        if (existsSync(full)) return full;
      }
    }

    return null;
  }

  async detectApps(): Promise<DetectedApp[]> {
    const apps: DetectedApp[] = [];
    const drives = getAvailableDrives();
    const foundPaths = new Set<string>();

    // Check default magnet handler from Windows registry
    const defaultMagnetExe = queryRegistry('HKCR\\magnet\\shell\\open\\command')
      || queryRegistry('HKCU\\Software\\Classes\\magnet\\shell\\open\\command');

    if (defaultMagnetExe && existsSync(defaultMagnetExe)) {
      foundPaths.add(defaultMagnetExe.toLowerCase());
      apps.push({
        id: 'system-default',
        name: 'Торрент-клиент по умолчанию (Windows)',
        type: 'client',
        path: defaultMagnetExe,
        description: `Системная программа Windows (${path.basename(defaultMagnetExe)})`
      });
    }

    // Detect specific clients
    for (const cand of CLIENT_CANDIDATES) {
      const exePath = this.resolveAppPath(cand, drives);
      if (exePath) {
        foundPaths.add(exePath.toLowerCase());
        apps.push({
          id: `client:${cand.id}`,
          name: cand.name,
          type: 'client',
          path: exePath,
          description: cand.description
        });
      }
    }

    // Direct streaming players (WebTorrent / SodaPlayer)
    const directPlayers = [
      { id: 'player:sodaplayer', name: 'Soda Player', path: path.join(LOCAL_APPDATA, 'SodaPlayer', 'SodaPlayer.exe') },
      { id: 'player:webtorrent', name: 'WebTorrent', path: path.join(LOCAL_APPDATA, 'WebTorrent', 'WebTorrent.exe') }
    ];
    for (const dp of directPlayers) {
      if (existsSync(dp.path)) {
        apps.push({
          id: dp.id,
          name: dp.name,
          type: 'player',
          path: dp.path,
          description: 'Торрент-плеер для онлайн-просмотра'
        });
      }
    }

    // Check TorrServer
    const torrServerRunning = await this.isTorrServerRunning();
    const torrExe = this.findTorrServerExe();
    const hasTorrServer = torrServerRunning || Boolean(torrExe);

    if (hasTorrServer) {
      // Find players compatible with TorrServer streams
      for (const player of PLAYER_CANDIDATES) {
        let playerExe = this.resolveAppPath(player as CandidateDefinition, drives);
        if (playerExe) {
          apps.push({
            id: `player:torrserver-${player.id}`,
            name: `TorrServer + ${player.name}`,
            type: 'player',
            path: playerExe,
            description: 'Онлайн-просмотр торрента без предварительного скачивания'
          });
        }
      }

      // TorrServer Web player in browser
      apps.push({
        id: 'player:torrserver-browser',
        name: 'TorrServer (в браузере)',
        type: 'player',
        path: 'http://127.0.0.1:8090',
        description: 'Онлайн-просмотр через встроенный веб-интерфейс TorrServer'
      });
    }

    this.cachedApps = apps;
    return apps;
  }

  private async ensureTorrServerRunning(): Promise<boolean> {
    if (await this.isTorrServerRunning()) {
      return true;
    }
    const exe = this.findTorrServerExe();
    if (!exe) return false;

    try {
      const child = spawn(exe, [], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (await this.isTorrServerRunning()) {
          return true;
        }
      }
    } catch {
      // Ignore
    }
    return false;
  }

  async openMagnetWith(
    magnetUrl: string,
    appId: string,
    title?: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!magnetUrl.startsWith('magnet:')) {
      return { ok: false, error: 'Некорректная magnet-ссылка' };
    }

    if (appId === 'system-default') {
      try {
        await shell.openExternal(magnetUrl);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    }

    // Direct streaming players
    if (appId === 'player:sodaplayer' || appId === 'player:webtorrent') {
      const apps = await this.detectApps();
      const target = apps.find((a) => a.id === appId);
      if (target && existsSync(target.path)) {
        try {
          spawn(target.path, [magnetUrl], { detached: true, stdio: 'ignore' }).unref();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }
    }

    // TorrServer players
    if (appId.startsWith('player:torrserver-')) {
      const ready = await this.ensureTorrServerRunning();
      if (!ready) {
        return {
          ok: false,
          error: 'Не удалось запустить TorrServer. Убедитесь, что TorrServer установлен и доступен для запуска.'
        };
      }

      const streamUrl = `http://127.0.0.1:8090/stream?link=${encodeURIComponent(magnetUrl)}${title ? `&title=${encodeURIComponent(title)}` : ''}&play`;

      if (appId === 'player:torrserver-browser') {
        try {
          await shell.openExternal(streamUrl);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }

      const apps = await this.detectApps();
      const target = apps.find((a) => a.id === appId);
      if (target && existsSync(target.path)) {
        try {
          spawn(target.path, [streamUrl], { detached: true, stdio: 'ignore' }).unref();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }
    }

    // Client executables
    if (appId.startsWith('client:')) {
      const apps = await this.detectApps();
      const target = apps.find((a) => a.id === appId);
      if (target && existsSync(target.path)) {
        try {
          spawn(target.path, [magnetUrl], { detached: true, stdio: 'ignore' }).unref();
          return { ok: true };
        } catch (err) {
          return { ok: false, error: (err as Error).message };
        }
      }
    }

    // Fallback to system default
    try {
      await shell.openExternal(magnetUrl);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

export const appDetector = new AppDetector();
