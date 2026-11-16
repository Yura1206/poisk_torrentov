import { app } from 'electron';
import path from 'path';

let transcriberPromise: Promise<any> | null = null;

async function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      // Lazy import so transformers and ONNX are only loaded when voice search is actually triggered
      const { env, pipeline } = await import('@xenova/transformers');
      try {
        if (app && typeof app.getPath === 'function') {
          env.cacheDir = path.join(app.getPath('userData'), 'whisper-cache');
        }
      } catch {
        // fallback to default cache
      }
      env.allowLocalModels = true;
      try {
        // Try global HuggingFace mirror first for fast access in RU
        env.remoteHost = 'https://hf-mirror.com/';
        return await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
          quantized: true
        });
      } catch {
        // Fallback to standard huggingface
        env.remoteHost = 'https://huggingface.co/';
        return await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
          quantized: true
        });
      }
    })();
  }
  return transcriberPromise;
}

function normalizeSpeechResult(text: string): string {
  let cleaned = text.trim();
  // Phonetic & common speech-to-text corrections for cinema titles
  cleaned = cleaned.replace(/\bгарри\s+потер\b/gi, 'Гарри Поттер');
  cleaned = cleaned.replace(/\bпринци?полу[\s-]*кровка\b/gi, 'Принц-полукровка');
  cleaned = cleaned.replace(/\bпринц\s+полукровка\b/gi, 'Принц-полукровка');
  cleaned = cleaned.replace(/\bвластелин\s+колец\b/gi, 'Властелин колец');
  cleaned = cleaned.replace(/\bигра\s+престолов\b/gi, 'Игра престолов');
  cleaned = cleaned.replace(/\bзвездные\s+войны\b/gi, 'Звёздные войны');
  cleaned = cleaned.replace(/\bво\s+все\s+тяжкие\b/gi, 'Во все тяжкие');

  // Strip punctuation at edges
  cleaned = cleaned.replace(/^[.,!?:;\-–—\s]+|[.,!?:;\-–—\s]+$/g, '').trim();
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

export function cleanSuggestionSuffixes(s: string): string {
  let res = s || '';
  // Strip trailing search junk (смотреть онлайн, актеры, и т.д.)
  res = res.replace(/\s+(смотреть(\s+онлайн)?|в\s+хорошем\s+качестве|аудио(книга)?|слушать(\s+онлайн)?|актеры|актори|рутуб|вк|ютуб|книга|википедия|дата\s+выхода|голосование|участники|все\s+серии|отзывы|трейлер).*$/gi, '').trim();

  // Strip season, series, episode suffixes, e.g. "3 сезон", "сезон 3", "1 серия", "выпуск 5"
  res = res.replace(/\s*(?:[-–—|/]\s*)?(?:\d+\s+)?(?:сезон(?:ы|а)?|season(?:s)?|сери(?:и|я|й)|series|выпуск(?:и|ов)?|эпизод(?:ы|а)?|episode(?:s)?)(?:\s*\d+)?.*$/iu, '').trim();

  // Strip year suffixes, e.g. "2024 года", "1999"
  res = res.replace(/\s*(?:[-–—|/]\s*)?(?:19\d\d|20\d\d)(?:\s*года?)?.*$/iu, '').trim();
  res = res.replace(/\s*\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?.*$/iu, '').trim();
  return res.trim();
}

export function hasActualCorrection(original: string, candidate: string): boolean {
  const normOriginal = original.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const normCandidate = candidate.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!normOriginal || !normCandidate) return false;
  if (normOriginal === normCandidate) return false;

  const origWords = normOriginal.split(/\s+/).filter(Boolean);
  const candWords = normCandidate.split(/\s+/).filter(Boolean);

  // If candidate cleaned of seasons/series/years is identical to original, it's not a correction
  const cleanCand = cleanSuggestionSuffixes(candidate).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const cleanOrig = cleanSuggestionSuffixes(original).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (cleanCand === cleanOrig || cleanCand === normOriginal) {
    return false;
  }

  // If every word in original is already present in candidate without any spelling change,
  // then candidate is just adding words (season, year, part, etc.), NOT fixing a typo!
  const allOriginalWordsInCandidate = origWords.every((ow) => candWords.includes(ow));
  if (allOriginalWordsInCandidate) {
    return false;
  }

  return true;
}

export async function autoCorrectTitle(text: string): Promise<string> {
  if (!text || text.trim().length < 2) return text;
  const original = text.trim();
  let query = original;

  // 1. Google Suggest (full phrase entity & movie title recognition)
  try {
    const url = 'https://suggestqueries.google.com/complete/search?client=chrome&hl=ru&gl=ru&q=' + encodeURIComponent(original);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(2500)
    });
    if (res.ok) {
      const data = await res.json();
      const suggestions = Array.isArray(data[1]) ? (data[1] as string[]) : [];
      for (const rawSug of suggestions) {
        const cleaned = cleanSuggestionSuffixes(rawSug);
        if (!cleaned || cleaned.length < 2) continue;
        if (hasActualCorrection(original, cleaned)) {
          query = cleaned;
          break;
        }
      }
    }
  } catch {
    // ignore network timeout
  }

  // 2. Yandex Speller (word-by-word spelling corrections)
  try {
    const url = 'https://speller.yandex.net/services/spellservice.json/checkText?text=' + encodeURIComponent(query);
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const items = await res.json() as Array<{ word: string; s: string[] }>;
      if (Array.isArray(items) && items.length > 0) {
        let corrected = query;
        for (const item of items) {
          if (item.word && item.s && item.s[0]) {
            const regex = new RegExp(`\\b${item.word}\\b`, 'gi');
            corrected = corrected.replace(regex, item.s[0]);
          }
        }
        if (hasActualCorrection(original, corrected)) {
          query = corrected;
        }
      }
    }
  } catch {
    // ignore
  }

  // Final cleanup and capitalization
  query = query.replace(/^[.,!?:;\-–—\s]+|[.,!?:;\-–—\s]+$/g, '').trim();
  if (query.length > 0) {
    query = query.charAt(0).toUpperCase() + query.slice(1);
  }

  // Only return query if it has an actual typo/word correction, otherwise keep original
  if (!hasActualCorrection(original, query)) {
    return original;
  }

  return query;
}

export async function transcribeAudio(
  audioFloats: number[] | Float32Array
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const floatArray = audioFloats instanceof Float32Array ? audioFloats : new Float32Array(audioFloats);
    if (floatArray.length === 0) {
      return { ok: false, error: 'Запись голоса пуста' };
    }

    const transcriber = await getTranscriber();
    const result = await transcriber(floatArray, {
      language: 'russian',
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      prompt: 'Поиск фильмов и сериалов: Гарри Поттер и Принц-полукровка, Властелин колец, Игра престолов, фильмы, сезоны.'
    });

    const raw = typeof result?.text === 'string' ? result.text : '';
    const cleaned = normalizeSpeechResult(raw);

    // Apply Google + Yandex intelligent autocorrect (fixes hearing mistakes, slurred words, typos)
    const corrected = await autoCorrectTitle(cleaned);

    return { ok: true, text: corrected || cleaned };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Не удалось распознать речь'
    };
  }
}
