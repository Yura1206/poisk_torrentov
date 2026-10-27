import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, RendererApi, SearchRequest } from '../shared/types';

const api: RendererApi = {
  search: (request: SearchRequest) => ipcRenderer.invoke('search:run', request),
  cancelSearch: (requestId: string) => ipcRenderer.invoke('search:cancel', requestId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getHistory: () => ipcRenderer.invoke('history:get'),
  removeHistoryItem: (query: string) => ipcRenderer.invoke('history:remove', query),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  checkProviders: () => ipcRenderer.invoke('providers:check'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  copyMagnet: (magnet: string) => ipcRenderer.invoke('magnet:copy', magnet),
  openMagnet: (magnet: string) => ipcRenderer.invoke('magnet:open', magnet),
  resolveMagnet: (pageUrl: string) => ipcRenderer.invoke('magnet:resolve', pageUrl),
  resolveTopicDetails: (pageUrl: string) => ipcRenderer.invoke('topic:resolveDetails', pageUrl),
  downloadTorrent: (url: string, title: string) => ipcRenderer.invoke('torrent:download', url, title),
  openDataFolder: () => ipcRenderer.invoke('app:openDataFolder'),
  version: () => ipcRenderer.invoke('app:version'),
  openRuTrackerLogin: () => ipcRenderer.invoke('rutracker:loginWindow'),
  saveRuTrackerAuth: (auth: { cookie?: string; username?: string }) => ipcRenderer.invoke('rutracker:saveAuth', auth),
  clearRuTrackerAuth: () => ipcRenderer.invoke('rutracker:clearAuth'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  getDetectedApps: () => ipcRenderer.invoke('magnet:getApps'),
  openMagnetWith: (magnetUrl: string, appId: string, title?: string, saveAsDefault?: boolean) =>
    ipcRenderer.invoke('magnet:openWith', magnetUrl, appId, title, saveAsDefault),
  resolvePoster: (title: string, year?: number, pageUrl?: string, contentType?: string) =>
    ipcRenderer.invoke('poster:resolve', title, year, pageUrl, contentType),
  onSearchStream: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: import('../shared/types').SearchStreamPayload) => callback(payload);
    ipcRenderer.on('search:stream', handler);
    return () => { ipcRenderer.removeListener('search:stream', handler); };
  }
};

contextBridge.exposeInMainWorld('torrentApi', api);
