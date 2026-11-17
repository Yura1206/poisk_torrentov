import { describe, expect, it } from 'vitest';
import { cleanSuggestionSuffixes, hasActualCorrection, autoCorrectTitle } from './whisper-service';

describe('whisper-service query autocorrection rules', () => {
  it('strips season, episode, year and online view suffixes', () => {
    expect(cleanSuggestionSuffixes('Экстрасенсы реванш 3 сезон')).toBe('Экстрасенсы реванш');
    expect(cleanSuggestionSuffixes('Нейровася 2 сезон')).toBe('Нейровася');
    expect(cleanSuggestionSuffixes('Слово пацана 1 серия')).toBe('Слово пацана');
    expect(cleanSuggestionSuffixes('Интерстеллар смотреть онлайн')).toBe('Интерстеллар');
    expect(cleanSuggestionSuffixes('Матрица 1999 года')).toBe('Матрица');
  });

  it('rejects suggestions that only add season, series or year to correctly typed words', () => {
    expect(hasActualCorrection('экстрасенсы реванш', 'Экстрасенсы реванш 3 сезон')).toBe(false);
    expect(hasActualCorrection('нейровася', 'Нейровася 2 сезон')).toBe(false);
    expect(hasActualCorrection('интерстеллар', 'Интерстеллар смотреть онлайн')).toBe(false);
    expect(hasActualCorrection('камеди клаб', 'Камеди Клаб 2024')).toBe(false);
    expect(hasActualCorrection('инопланетянин', 'Инопланетянины существуют')).toBe(false);
  });

  it('accepts suggestions that fix an actual typo or misspelled word', () => {
    expect(hasActualCorrection('эктрасенсы реванш', 'Экстрасенсы реванш')).toBe(true);
    expect(hasActualCorrection('интерстелар', 'Интерстеллар')).toBe(true);
    expect(hasActualCorrection('мстители вайна', 'Мстители Война')).toBe(true);
  });

  it('accepts compound titles that were split into words or hyphenated', () => {
    expect(hasActualCorrection('Гангстер Ленд', 'Гангстерленд')).toBe(true);
    expect(hasActualCorrection('гангстер лэнд', 'Гангстерленд')).toBe(true);
  });

  it('autoCorrectTitle returns original query when no typos are present', async () => {
    const res1 = await autoCorrectTitle('экстрасенсы реванш');
    expect(res1).toBe('экстрасенсы реванш');

    const res2 = await autoCorrectTitle('нейровася');
    expect(res2).toBe('нейровася');
  });

  it('autoCorrectTitle fixes typos without adding season', async () => {
    const res = await autoCorrectTitle('интерстелар');
    expect(res).toBe('Интерстеллар');
    expect(res).not.toContain('сезон');
    expect(res).not.toContain('смотреть');
  });

  it('autoCorrectTitle fixes compound split titles like Гангстер Ленд to Гангстерленд', async () => {
    const res = await autoCorrectTitle('Гангстер Ленд');
    expect(res).toBe('Гангстерленд');
  });
});
