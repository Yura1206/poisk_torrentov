import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { AppDetector } from './app-detector';

describe('AppDetector', () => {
  it('обнаруживает только реально существующие на диске приложения', async () => {
    const detector = new AppDetector();
    const apps = await detector.detectApps();

    expect(Array.isArray(apps)).toBe(true);

    for (const app of apps) {
      expect(['client', 'player']).toContain(app.type);
      expect(app.name).toBeTruthy();
      expect(app.id).toBeTruthy();

      // Либо это веб-ссылка на локальный TorrServer, либо реально существующий исполняемый файл
      if (app.path.startsWith('http')) {
        expect(app.path).toContain('127.0.0.1');
      } else {
        expect(existsSync(app.path)).toBe(true);
      }
    }
  });

  it('не возвращает программы, пути к которым отсутствуют на компьютере', async () => {
    const detector = new AppDetector();
    const apps = await detector.detectApps();

    // Проверяем, что нет записей с пустым path
    const emptyPathApps = apps.filter((a) => !a.path);
    expect(emptyPathApps).toHaveLength(0);
  });
});
