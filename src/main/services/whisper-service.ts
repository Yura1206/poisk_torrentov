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
  cleaned = cleaned.replace(/\bгангстер[\s-]+л[еэ]нд\b/gi, 'Гангстерленд');
  cleaned = cleaned.replace(/\bчеловек[\s-]+паук\b/gi, 'Человек-паук');
  cleaned = cleaned.replace(/\bла[\s-]+ла[\s-]+л[еэ]нд\b/gi, 'Ла-Ла Ленд');
  cleaned = cleaned.replace(/\bдэд[\s-]*пул\b/gi, 'Дэдпул');
  cleaned = cleaned.replace(/\bдед[\s-]*пул\b/gi, 'Дэдпул');
  cleaned = cleaned.replace(/\bаква[\s-]*мен\b/gi, 'Аквамен');
  cleaned = cleaned.replace(/\bбэт[\s-]*мен\b/gi, 'Бэтмен');
  cleaned = cleaned.replace(/\bспайдер[\s-]*мен\b/gi, 'Спайдермен');
  cleaned = cleaned.replace(/\bсаша[\s-]+таня\b/gi, 'СашаТаня');

  // Strip punctuation at edges
  cleaned = cleaned.replace(/^[.,!?:;\-–—\s]+|[.,!?:;\-–—\s]+$/g, '').trim();
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export function cleanSuggestionSuffixes(s: string): string {
  let res = s || '';

  // 1. Strip season, series, episode, part with preceding or succeeding numbers: e.g. "2 сезон", "сезон 2", "1 серия", "выпуск 3", "2 часть"
  res = res.replace(/\s*(?:[-–—|/]\s*)?\b\d+\s*(?:сезон(?:ы|а)?|season(?:s)?|сери(?:и|я|й)|series|выпуск(?:и|ов)?|эпизод(?:ы|а)?|episode(?:s)?|часть).*$/iu, '').trim();
  res = res.replace(/\s*(?:[-–—|/]\s*)?(?:сезон(?:ы|а)?|season(?:s)?|сери(?:и|я|й)|series|выпуск(?:и|ов)?|эпизод(?:ы|а)?|episode(?:s)?|часть)(?:\s*\d+)?.*$/iu, '').trim();

  // 2. Strip trailing search junk (смотреть онлайн, актеры, и т.д.)
  res = res.replace(/\s+(смотреть(\s+онлайн)?|в\s+хорошем\s+качестве|аудио(книга)?|слушать(\s+онлайн)?|актеры|актори|рутуб|вк|ютуб|книга|википедия|дата\s+выхода|голосование|участники|все\s+серии|отзывы|трейлер).*$/gi, '').trim();

  // 3. Strip year suffixes, e.g. "2024 года", "1999"
  res = res.replace(/\s*(?:[-–—|/]\s*)?(?:19\d\d|20\d\d)(?:\s*года?)?.*$/iu, '').trim();
  res = res.replace(/\s*\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?.*$/iu, '').trim();

  // 4. Strip lone trailing numbers left behind by suggestion queries (e.g. "Нейровася 2" or "Гангстер ленд 2")
  res = res.replace(/\s+\d+$/u, '').trim();

  return res.trim();
}

export function hasActualCorrection(original: string, candidate: string): boolean {
  const normOriginal = original.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const normCandidate = candidate.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!normOriginal || !normCandidate) return false;
  if (normOriginal === normCandidate) return false;

  // Never allow candidate to introduce new numbers/digits if original had none
  const origHasDigits = /\d/.test(normOriginal);
  const candHasDigits = /\d/.test(normCandidate);
  if (!origHasDigits && candHasDigits) {
    return false;
  }

  const origWords = normOriginal.split(/\s+/).filter(Boolean);
  const candWords = normCandidate.split(/\s+/).filter(Boolean);

  // Candidate stripped of suffixes must match
  const cleanCand = cleanSuggestionSuffixes(candidate).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const cleanOrig = cleanSuggestionSuffixes(original).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (cleanCand === cleanOrig || cleanCand === normOriginal) {
    return false;
  }

  // 1. Same word count: check word-by-word typo distance (<= 2)
  if (origWords.length === candWords.length) {
    let typoFound = false;
    for (let i = 0; i < origWords.length; i++) {
      const ow = origWords[i];
      const cw = candWords[i];
      if (ow === cw) continue;

      const dist = levenshteinDistance(ow, cw);
      const maxAllowedDist = ow.length > 5 ? 2 : 1;
      if (dist <= maxAllowedDist) {
        typoFound = true;
      } else {
        // Word completely changed or unrelated
        return false;
      }
    }
    return typoFound;
  }

  // 2. Joining compound words (e.g. "гангстер ленд" -> "гангстерленд", "интер стеллар" -> "интерстеллар", "дэд пул" -> "дэдпул")
  // Only allowed when words were merged (candidate has fewer words than original), no added words or numbers
  if (candWords.length < origWords.length) {
    const noSpaceOrig = normOriginal.replace(/\s+/g, '');
    const noSpaceCand = normCandidate.replace(/\s+/g, '');

    if (Math.abs(noSpaceOrig.length - noSpaceCand.length) <= 2) {
      const dist = levenshteinDistance(noSpaceOrig, noSpaceCand);
      const maxAllowedDist = Math.min(noSpaceOrig.length, noSpaceCand.length) > 5 ? 2 : 1;
      if (dist <= maxAllowedDist) {
        return true;
      }
    }
  }

  return false;
}

export async function autoCorrectTitle(text: string): Promise<string> {
  if (!text || text.trim().length < 2) return text;
  const original = text.trim();

  // 1. Yandex Speller: check dictionary spelling for typos
  try {
    const url = 'https://speller.yandex.net/services/spellservice.json/checkText?lang=ru,en&text=' + encodeURIComponent(original);
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const items = await res.json() as Array<{ word: string; s: string[] }>;
      if (Array.isArray(items) && items.length > 0) {
        let corrected = original;
        for (const item of items) {
          if (item.word && item.s && item.s[0]) {
            const regex = new RegExp(`\\b${item.word}\\b`, 'gi');
            corrected = corrected.replace(regex, item.s[0]);
          }
        }
        corrected = corrected.replace(/^[.,!?:;\-–—\s]+|[.,!?:;\-–—\s]+$/g, '').trim();
        if (corrected.length > 0) {
          corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
        }
        if (hasActualCorrection(original, corrected)) {
          return corrected;
        }
      }
    }
  } catch {
    // ignore network timeout
  }

  // 2. Google Suggest: check if common search queries provide typo/compound corrections
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
          let formatted = cleaned.replace(/^[.,!?:;\-–—\s]+|[.,!?:;\-–—\s]+$/g, '').trim();
          if (formatted.length > 0) {
            formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
          }
          return formatted;
        }
      }
    }
  } catch {
    // ignore network timeout
  }

  // 3. Compound title check via TMDB: if words were spoken separated by spaces, check if joining them forms a real title (e.g. "Гангстер Ленд" -> "Гангстерленд")
  if (original.includes(' ')) {
    const merged = original.replace(/\s+/g, '');
    if (merged.length >= 4) {
      try {
        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(merged)}&api_key=4ef0d7355d9ffb5151e987764708ce96&language=ru-RU`;
        const tmdbRes = await fetch(tmdbUrl, { signal: AbortSignal.timeout(2000) });
        if (tmdbRes.ok) {
          const tmdbData = await tmdbRes.json() as { results?: Array<{ title?: string; name?: string }> };
          if (Array.isArray(tmdbData.results) && tmdbData.results.length > 0) {
            const first = tmdbData.results[0];
            const cand = first.title || first.name;
            if (cand && hasActualCorrection(original, cand)) {
              return cand;
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return original;
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
