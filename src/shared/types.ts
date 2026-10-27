export type ContentType = 'all' | 'movie' | 'series' | 'reality';
export type LanguageStatus = 'confirmed' | 'unknown';
export type Resolution = '360p' | '480p' | '576p' | '720p' | '1080p' | '1440p' | '2160p' | 'unknown';
export type DynamicRange = 'sdr' | 'hdr' | 'hdr10' | 'hdr10plus' | 'dolby-vision' | 'unknown';

export interface TorrentResult {
  id: string;
  providerId: string;
  providerName: string;
  providerItemId?: string;
  rawTitle: string;
  title: string;
  alternativeTitles: string[];
  year?: number;
  contentType: Exclude<ContentType, 'all'>;
  season?: number;
  part?: number;
  resolution: Resolution;
  dynamicRange: DynamicRange;
  studios: string[];
  languageStatus: LanguageStatus;
  sizeBytes?: number;
  sizeLabel: string;
  fileCount?: number;
  seeds?: number;
  leeches?: number;
  publishedAt?: string;
  updatedAt?: string;
  pageUrl: string;
  torrentUrl?: string;
  magnetUrl?: string;
  relevance: number;
}

export interface ProviderState {
  id: string;
  name: string;
  enabled: boolean;
  status: 'idle' | 'searching' | 'ok' | 'error' | 'disabled';
  message?: string;
  received?: number;
  requiresAuth?: boolean;
  authorized?: boolean;
}

export interface SearchRequest {
  requestId: string;
  query: string;
  exact: boolean;
  contentType: ContentType;
  page?: number;
}

export interface SearchResponse {
  requestId: string;
  results: TorrentResult[];
  providerStates: ProviderState[];
  cancelled?: boolean;
  hasMore?: boolean;
}

export interface RuTrackerAuth {
  authorized: boolean;
  cookie?: string;
  username?: string;
  updatedAt?: string;
}

export interface DetectedApp {
  id: string;
  name: string;
  type: 'client' | 'player';
  path: string;
  description: string;
}

export interface AppSettings {
  showUnconfirmedLanguage: boolean;
  providers: Array<Pick<ProviderState, 'id' | 'name' | 'enabled'> & { note?: string; requiresAuth?: boolean; authorized?: boolean }>;
  customStudios: string[];
  qualityAliases: Array<{ term: string; resolution: Exclude<Resolution, 'unknown'> }>;
  rutrackerAuth?: RuTrackerAuth;
  magnetAction?: string;
}

export interface FilterState {
  resolutions: Resolution[];
  dynamicRanges: DynamicRange[];
  seasons: number[];
  parts: number[];
  studios: string[];
  language: 'confirmed' | 'all';
  providers?: string[];
  years?: number[];
}

export type SortField = 'relevance' | 'title' | 'seeds' | 'size' | 'published' | 'updated';
export interface SortState {
  field: SortField;
  direction: 'asc' | 'desc';
}

export interface SearchStreamPayload {
  requestId: string;
  batch: TorrentResult[];
  providerState: ProviderState;
}

export interface RendererApi {
  search: (request: SearchRequest) => Promise<SearchResponse>;
  cancelSearch: (requestId: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  getHistory: () => Promise<string[]>;
  removeHistoryItem: (query: string) => Promise<string[]>;
  clearHistory: () => Promise<void>;
  checkProviders: () => Promise<ProviderState[]>;
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  copyMagnet: (magnet: string) => Promise<{ ok: boolean; error?: string }>;
  openMagnet: (magnet: string) => Promise<{ ok: boolean; error?: string }>;
  resolveMagnet: (pageUrl: string) => Promise<{ ok: boolean; magnet?: string; error?: string }>;
  resolveTopicDetails?: (pageUrl: string) => Promise<{
    ok: boolean;
    details?: {
      resolution?: Resolution;
      dynamicRange?: DynamicRange;
      magnetUrl?: string;
      translations?: string[];
    };
    error?: string;
  }>;
  downloadTorrent: (url: string, title: string) => Promise<{ ok: boolean; error?: string }>;
  openDataFolder: () => Promise<void>;
  version: () => Promise<string>;
  openRuTrackerLogin: () => Promise<{ ok: boolean; username?: string; error?: string }>;
  saveRuTrackerAuth: (auth: { cookie?: string; username?: string }) => Promise<{ ok: boolean; username?: string; error?: string }>;
  clearRuTrackerAuth: () => Promise<void>;
  readClipboard?: () => Promise<string>;
  onSearchStream?: (callback: (payload: SearchStreamPayload) => void) => () => void;
  getDetectedApps: () => Promise<DetectedApp[]>;
  openMagnetWith: (magnetUrl: string, appId: string, title?: string, saveAsDefault?: boolean) => Promise<{ ok: boolean; error?: string }>;
  resolvePoster: (title: string, year?: number, pageUrl?: string, contentType?: string) => Promise<string | null>;
}

declare global {
  interface Window {
    torrentApi: RendererApi;
  }
}
