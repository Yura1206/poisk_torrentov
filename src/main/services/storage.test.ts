import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LocalStorage } from './storage';

describe('LocalStorage', () => {
  it('содержит только русскоязычные источники (rutor, nnmclub, megapeer, torrentkino, rutracker) и исключает зарубежные и неработающие', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'torrent-storage-test-'));
    try {
      const storage = new LocalStorage(tmpDir);
      await storage.load();
      const ids = storage.settings.providers.map((p) => p.id);

      expect(ids).not.toContain('kinozal');
      expect(ids).not.toContain('thepiratebay');
      expect(ids).not.toContain('yts');

      expect(ids).toEqual(['rutor', 'nnmclub', 'megapeer', 'torrentkino', 'rutracker']);

      const nnm = storage.settings.providers.find((p) => p.id === 'nnmclub');
      expect(nnm?.name).toBe('NNM');

      const rutracker = storage.settings.providers.find((p) => p.id === 'rutracker');
      expect(rutracker?.requiresAuth).toBe(true);
      expect(rutracker?.authorized).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('сохраняет и очищает статус авторизации RuTracker', async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'torrent-storage-test-'));
    try {
      const storage = new LocalStorage(tmpDir);
      await storage.load();

      await storage.setRuTrackerAuth({
        authorized: true,
        cookie: 'bb_data=abc; bb_session=123',
        username: 'TestUser'
      });

      expect(storage.rutrackerAuth?.authorized).toBe(true);
      expect(storage.rutrackerAuth?.username).toBe('TestUser');

      const rutrackerProvider = storage.settings.providers.find((p) => p.id === 'rutracker');
      expect(rutrackerProvider?.authorized).toBe(true);
      expect(rutrackerProvider?.enabled).toBe(true);

      await storage.clearRuTrackerAuth();
      expect(storage.rutrackerAuth?.authorized).toBe(false);
      expect(storage.settings.providers.find((p) => p.id === 'rutracker')?.authorized).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
