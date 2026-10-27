import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, RuTrackerAuth } from '../../shared/types';

interface PersistedData {
  settings: AppSettings;
  history: string[];
  window?: { x?: number; y?: number; width: number; height: number; maximized?: boolean };
}

const defaultProviders = (): AppSettings['providers'] => [
  { id: 'rutor', name: 'RuTor', enabled: true },
  { id: 'nnmclub', name: 'NNM', enabled: true },
  { id: 'megapeer', name: 'MegaPeer', enabled: true },
  { id: 'torrentkino', name: 'TorrentKino', enabled: true },
  { id: 'rutracker', name: 'RuTracker', enabled: false, requiresAuth: true, note: 'Требуется авторизация.' }
];

const defaults = (): PersistedData => ({
  settings: {
    showUnconfirmedLanguage: false,
    providers: defaultProviders(),
    customStudios: [],
    qualityAliases: [],
    magnetAction: 'ask',
    rutrackerAuth: {
      authorized: false
    }
  },
  history: []
});

export class LocalStorage {
  private data: PersistedData = defaults();
  private readonly file: string;

  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as Partial<PersistedData>;
      const initial = defaults();
      // Filter out kinozal or obsolete foreign providers from saved data
      const obsolete = new Set(['kinozal', 'thepiratebay', 'yts']);
      const savedProviders = (parsed.settings?.providers ?? []).filter((p) => !obsolete.has(p.id));
      const isRuTrackerAuthorized = Boolean(parsed.settings?.rutrackerAuth?.authorized);

      this.data = {
        ...initial,
        ...parsed,
        settings: {
          ...initial.settings,
          ...parsed.settings,
          providers: initial.settings.providers.map((provider) => {
            const saved = savedProviders.find((item) => item.id === provider.id);
            return {
              ...provider,
              enabled: saved ? saved.enabled : provider.enabled,
              authorized: provider.id === 'rutracker' ? isRuTrackerAuthorized : undefined
            };
          }),
          rutrackerAuth: {
            authorized: isRuTrackerAuthorized,
            cookie: parsed.settings?.rutrackerAuth?.cookie,
            username: parsed.settings?.rutrackerAuth?.username,
            updatedAt: parsed.settings?.rutrackerAuth?.updatedAt
          },
          magnetAction: parsed.settings?.magnetAction ?? 'ask'
        }
      };
    } catch {
      await this.save();
    }
  }

  get settings(): AppSettings {
    const cloned = structuredClone(this.data.settings);
    const isRuTrackerAuthorized = Boolean(this.data.settings.rutrackerAuth?.authorized);
    for (const provider of cloned.providers) {
      if (provider.id === 'rutracker') {
        provider.authorized = isRuTrackerAuthorized;
      }
    }
    return cloned;
  }

  get rutrackerAuth(): RuTrackerAuth | undefined {
    return this.data.settings.rutrackerAuth ? structuredClone(this.data.settings.rutrackerAuth) : undefined;
  }

  get history(): string[] { return [...this.data.history]; }
  get windowBounds(): PersistedData['window'] { return this.data.window ? { ...this.data.window } : undefined; }

  async saveSettings(settings: AppSettings): Promise<AppSettings> {
    const providerDefaults = defaultProviders();
    const isRuTrackerAuthorized = Boolean(this.data.settings.rutrackerAuth?.authorized);

    this.data.settings = {
      showUnconfirmedLanguage: Boolean(settings.showUnconfirmedLanguage),
      providers: providerDefaults.map((provider) => {
        const saved = settings.providers.find((item) => item.id === provider.id);
        return {
          ...provider,
          enabled: Boolean(saved ? saved.enabled : provider.enabled),
          authorized: provider.id === 'rutracker' ? isRuTrackerAuthorized : undefined
        };
      }),
      customStudios: (settings.customStudios || []).map((name) => name.trim()).filter(Boolean).slice(0, 100),
      qualityAliases: (settings.qualityAliases || []).filter((alias) => alias.term.trim() && ['720p', '1080p', '1440p', '2160p'].includes(alias.resolution)).map((alias) => ({ term: alias.term.trim().slice(0, 80), resolution: alias.resolution })).slice(0, 100),
      magnetAction: settings.magnetAction || 'ask',
      rutrackerAuth: this.data.settings.rutrackerAuth
    };
    await this.save();
    return this.settings;
  }

  async setRuTrackerAuth(auth: RuTrackerAuth): Promise<void> {
    this.data.settings.rutrackerAuth = {
      ...auth,
      updatedAt: new Date().toISOString()
    };
    const rutracker = this.data.settings.providers.find((p) => p.id === 'rutracker');
    if (rutracker) {
      rutracker.authorized = auth.authorized;
      if (auth.authorized) {
        rutracker.enabled = true;
      }
    }
    await this.save();
  }

  async clearRuTrackerAuth(): Promise<void> {
    this.data.settings.rutrackerAuth = {
      authorized: false
    };
    const rutracker = this.data.settings.providers.find((p) => p.id === 'rutracker');
    if (rutracker) {
      rutracker.authorized = false;
    }
    await this.save();
  }

  async addHistory(query: string): Promise<void> {
    const normalised = query.replace(/\s+/gu, ' ').trim();
    if (!normalised) return;
    this.data.history = [normalised, ...this.data.history.filter((item) => item.toLocaleLowerCase('ru-RU') !== normalised.toLocaleLowerCase('ru-RU'))].slice(0, 30);
    await this.save();
  }

  async removeHistoryItem(query: string): Promise<string[]> {
    const normalised = query.replace(/\s+/gu, ' ').trim().toLowerCase();
    this.data.history = this.data.history.filter((item) => item.trim().toLowerCase() !== normalised);
    await this.save();
    return [...this.data.history];
  }

  async clearHistory(): Promise<void> {
    this.data.history = [];
    await this.save();
  }

  async saveWindow(bounds: NonNullable<PersistedData['window']>): Promise<void> {
    this.data.window = { ...bounds };
    await this.save();
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.data, null, 2), 'utf8');
    await rename(temporary, this.file);
  }
}
