import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, ContentType, DetectedApp, DynamicRange, FilmRatings, FilterState, ProviderState, Resolution, SortState, TorrentResult } from '../shared/types';
import { emptyFilters, filterResults, sortResults } from '../main/lib/filter-engine';

const resolutionLabels: Record<Resolution, string> = {
  '360p': '360p',
  '480p': '480p',
  '576p': '576p',
  '720p': '720p',
  '1080p': '1080p',
  '1440p': '1440p',
  '2160p': '2160p',
  unknown: 'Не указано'
};
const rangeLabels: Record<DynamicRange, string> = { sdr: 'SDR', hdr: 'HDR', hdr10: 'HDR', hdr10plus: 'HDR', 'dolby-vision': 'Dolby Vision', unknown: 'Не указано' };
const contentLabels: Record<ContentType, string> = { all: 'Всё', movie: 'Фильм', series: 'Сериал', reality: 'Реалити-шоу' };
const contentTypeFilterValues: Array<Exclude<ContentType, 'all'>> = ['movie', 'series', 'reality'];
const contentTypeFilterLabels: Record<Exclude<ContentType, 'all'>, string> = { movie: 'Фильм', series: 'Сериал', reality: 'Шоу' };
const initialSort: SortState = { field: 'relevance', direction: 'desc' };
const PAGE_SIZE = 48;
const globalRatingsCache = new Map<string, FilmRatings | null>();

function getRatingCacheKey(title: string, year?: number, contentType?: string): string {
  const clean = title
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${clean}:${year ?? ''}:${contentType ?? ''}`;
}

const COUNTRIES_LIST = [
  'США', 'Россия', 'Франция', 'Великобритания', 'Германия', 'Италия', 'Испания',
  'Канада', 'Япония', 'Южная Корея', 'Корея', 'Австралия', 'Индия', 'СССР',
  'Китай', 'Дания', 'Швеция', 'Норвегия', 'Польша', 'Турция', 'Мексика',
  'Бразилия', 'Ирландия', 'Бельгия', 'Нидерланды', 'Австрия', 'Швейцария',
  'Финляндия', 'Новая Зеландия', 'Гонконг', 'Тайвань', 'Чехия', 'Венгрия'
];
const countryPattern = new RegExp(`(?<![\\p{L}\\p{N}])(${COUNTRIES_LIST.join('|')})(?![\\p{L}\\p{N}])`, 'iu');

function extractCountry(rawTitle?: string): string | undefined {
  if (!rawTitle) return undefined;
  const match = rawTitle.match(countryPattern);
  if (!match) return undefined;
  const found = match[1];
  if (found.toUpperCase() === 'США' || found.toUpperCase() === 'СССР') return found.toUpperCase();
  return found.charAt(0).toUpperCase() + found.slice(1).toLowerCase();
}

function formatReleaseSubline(
  item: { contentType: ContentType; year?: number; years?: number[]; season?: number; seasons?: number[]; part?: number },
  activeYear?: number
): string {
  let typeWord = 'Фильм';
  if (item.contentType === 'series') typeWord = 'Сериал';
  else if (item.contentType === 'reality') typeWord = 'Телешоу';

  let displayYear = item.year;
  let displaySeason = item.season;

  const minYear = item.years && item.years.length > 0 ? Math.min(...item.years) : item.year;
  const maxYear = item.years && item.years.length > 0 ? Math.max(...item.years) : item.year;
  const hasYearRange = minYear !== undefined && maxYear !== undefined && minYear !== maxYear;

  if (activeYear) {
    displayYear = activeYear;
    const itemSeasons = item.seasons && item.seasons.length > 0 ? item.seasons : (item.season ? [item.season] : []);
    const itemYears = item.years && item.years.length > 0 ? item.years : (item.year ? [item.year] : []);
    if (itemSeasons.length > 1 && itemYears.length > 1) {
      const yIdx = itemYears.indexOf(activeYear);
      if (yIdx >= 0 && yIdx < itemSeasons.length) {
        displaySeason = itemSeasons[yIdx];
      }
    }
  }

  let yearPart = '';
  if (activeYear && hasYearRange) {
    yearPart = `${activeYear} года (${minYear}–${maxYear})`;
  } else if (hasYearRange) {
    yearPart = `${minYear}–${maxYear} годов`;
  } else if (displayYear) {
    yearPart = `${displayYear} года`;
  }

  let text = yearPart ? `${typeWord} ${yearPart}` : typeWord;

  if (displaySeason && (item.contentType === 'series' || item.contentType === 'reality')) {
    text += ` · Сезон ${displaySeason}`;
  }

  if (item.part) {
    text += ` · Часть ${item.part}`;
  }

  return text;
}

function levenshteinDistance(a: string, b: string): number {
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

function hasActualCorrection(original: string, candidate: string): boolean {
  const normOriginal = original.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const normCandidate = candidate.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!normOriginal || !normCandidate) return false;
  if (normOriginal === normCandidate) return false;

  const origWords = normOriginal.split(/\s+/).filter(Boolean);
  const candWords = normCandidate.split(/\s+/).filter(Boolean);

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
        return false;
      }
    }
    return typoFound;
  }

  // 2. Different word count: allow if compound words were joined or re-segmented (e.g. "гангстер ленд" -> "гангстерленд", "человек паук" -> "человек-паук")
  const noSpaceOrig = normOriginal.replace(/\s+/g, '');
  const noSpaceCand = normCandidate.replace(/\s+/g, '');

  if (Math.abs(noSpaceOrig.length - noSpaceCand.length) <= 2) {
    const dist = levenshteinDistance(noSpaceOrig, noSpaceCand);
    const maxAllowedDist = Math.min(noSpaceOrig.length, noSpaceCand.length) > 5 ? 2 : 1;
    if (dist <= maxAllowedDist) {
      return true;
    }
  }

  return false;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [exact, setExact] = useState(false);
  const [contentType, setContentType] = useState<ContentType>('all');
  const [results, setResults] = useState<TorrentResult[]>([]);
  const [states, setStates] = useState<ProviderState[]>([]);
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [sort, setSort] = useState<SortState>(initialSort);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const [providerCheckStates, setProviderCheckStates] = useState<ProviderState[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const resolvedTopicUrls = useRef<Set<string>>(new Set());
  const [detectedApps, setDetectedApps] = useState<DetectedApp[]>([]);
  const [magnetModal, setMagnetModal] = useState<{ item: TorrentResult; magnet: string; onlyPlayers?: boolean } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [didYouMean, setDidYouMean] = useState<string | null>(null);
  const [typingSuggestion, setTypingSuggestion] = useState<string | null>(null);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      return (localStorage.getItem('viewMode') as 'list' | 'grid') || 'list';
    } catch {
      return 'list';
    }
  });
  const [detailTorrent, setDetailTorrent] = useState<TorrentResult | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const currentHoveredId = useRef<string | null>(null);
  const [hoverPoster, setHoverPoster] = useState<{
    item: TorrentResult;
    x: number;
    y: number;
    url?: string;
    loading?: boolean;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsViewportRef = useRef<HTMLDivElement>(null);
  const [sharedHeight, setSharedHeight] = useState<number | undefined>(undefined);

  const checkProvidersAvailability = async () => {
    setCheckingProviders(true);
    try {
      const res = await window.torrentApi.checkProviders();
      setProviderCheckStates(res);
      return res;
    } catch {
      // ignore
    } finally {
      setCheckingProviders(false);
    }
  };

  useEffect(() => {
    Promise.all([window.torrentApi.getSettings(), window.torrentApi.getHistory()]).then(([saved, queries]) => {
      setSettings(saved);
      setHistory(queries);
    });
    void checkProvidersAvailability();
    window.torrentApi.getDetectedApps().then(setDetectedApps).catch(() => {});

    const unsubStream = window.torrentApi.onSearchStream?.((payload) => {
      if (requestId.current && requestId.current !== payload.requestId) return;
      setStates((prev) => {
        const without = prev.filter((s) => s.id !== payload.providerState.id);
        return [...without, payload.providerState];
      });
    });

    const unsubCheckStream = window.torrentApi.onProviderCheckStream?.((state) => {
      setProviderCheckStates((prev) => {
        const without = prev.filter((s) => s.id !== state.id);
        return [...without, state];
      });
    });

    return () => {
      if (requestId.current) void window.torrentApi.cancelSearch(requestId.current);
      unsubStream?.();
      unsubCheckStream?.();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!historyOpen && !typingSuggestion) return;
    const handleOutside = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
        setTypingSuggestion(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setHistoryOpen(false);
        setTypingSuggestion(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [historyOpen, typingSuggestion]);

  useEffect(() => {
    setPage(0);
  }, [filters, sort]);

  useEffect(() => {
    if (!searched || searching || results.length > 0 || !query || query.length < 3) {
      setDidYouMean(null);
      return;
    }
    let active = true;
    void window.torrentApi.correctQuery?.(query).then((corrected) => {
      if (active && corrected && hasActualCorrection(query, corrected)) {
        setDidYouMean(corrected);
      }
    });
    return () => {
      active = false;
    };
  }, [searched, searching, results.length, query]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3 || searching || isRecording || isTranscribing) {
      setTypingSuggestion(null);
      return;
    }
    if (dismissedQuery === trimmed) {
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const corrected = await window.torrentApi.correctQuery?.(trimmed);
        if (!corrected) {
          setTypingSuggestion(null);
          return;
        }
        if (hasActualCorrection(trimmed, corrected)) {
          setTypingSuggestion(corrected);
        } else {
          setTypingSuggestion(null);
        }
      } catch {
        setTypingSuggestion(null);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [query, searching, isRecording, isTranscribing, dismissedQuery]);

  const visible = useMemo(() => sortResults(filterResults(results, filters), sort), [results, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const pagedResults = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return visible.slice(start, start + PAGE_SIZE);
  }, [visible, currentPage]);

  useEffect(() => {
    const el = resultsViewportRef.current;
    if (!el) return;
    const updateDimensions = () => {
      if (!resultsViewportRef.current) return;
      const rect = resultsViewportRef.current.getBoundingClientRect();
      const bottomReserve = 58;
      const available = Math.max(380, window.innerHeight - rect.top - bottomReserve);
      setSharedHeight(available);
    };

    updateDimensions();
    const raf = requestAnimationFrame(updateDimensions);
    const timer = setTimeout(updateDimensions, 100);

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateDimensions) : null;
    if (el.parentElement) ro?.observe(el.parentElement);
    window.addEventListener('resize', updateDimensions);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [results, visible]);

  useEffect(() => {
    if (!searched || searching || pagedResults.length === 0) return;
    const unknownItems = pagedResults.filter(
      (item) => item.resolution === 'unknown' && item.pageUrl && !resolvedTopicUrls.current.has(item.pageUrl)
    );
    if (unknownItems.length === 0) return;

    let cancelled = false;
    const resolvePending = async () => {
      for (const item of unknownItems) {
        if (cancelled) break;
        resolvedTopicUrls.current.add(item.pageUrl);
        try {
          const res = await window.torrentApi.resolveTopicDetails?.(item.pageUrl);
          if (cancelled) break;
          if (res?.ok && res.details) {
            const { resolution, dynamicRange, magnetUrl } = res.details;
            if (resolution || dynamicRange || magnetUrl) {
              setResults((prev) =>
                prev.map((r) =>
                  r.id === item.id
                    ? {
                        ...r,
                        resolution: resolution && resolution !== 'unknown' ? resolution : r.resolution,
                        dynamicRange: dynamicRange && dynamicRange !== 'unknown' ? dynamicRange : r.dynamicRange,
                        magnetUrl: magnetUrl || r.magnetUrl
                      }
                    : r
                )
              );
            }
          }
        } catch {
          // ignore background errors
        }
      }
    };

    void resolvePending();
    return () => {
      cancelled = true;
    };
  }, [searched, searching, currentPage, pagedResults]);

  useEffect(() => {
    if (!searched || searching || pagedResults.length === 0) return;
    const seen = new Set<string>();
    for (const item of pagedResults) {
      const key = getRatingCacheKey(item.title, item.year, item.contentType);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!globalRatingsCache.has(key)) {
        void window.torrentApi.resolveRatings?.(item.title, item.year, item.pageUrl, item.contentType).then((r) => {
          globalRatingsCache.set(key, r ?? null);
        }).catch(() => {});
      }
    }
  }, [searched, searching, currentPage, pagedResults]);

  const relevantResultsForSeasons = useMemo(() => {
    const activeYears = filters.years;
    const activeContentTypes = filters.contentTypes;
    return results.filter((item) => {
      if (activeContentTypes && activeContentTypes.length > 0) {
        if (!activeContentTypes.includes(item.contentType as any)) return false;
      }
      if (activeYears && activeYears.length > 0) {
        const itemYears = item.years && item.years.length > 0 ? item.years : (item.year ? [item.year] : []);
        if (!itemYears.some((y) => activeYears.includes(y))) return false;
      }
      if (filters.providers?.length && !filters.providers.includes(item.providerId)) return false;
      if (filters.resolutions.length && !filters.resolutions.includes(item.resolution)) return false;
      return true;
    });
  }, [results, filters.contentTypes, filters.years, filters.providers, filters.resolutions]);

  const hasSeriesInActiveView = useMemo(() => {
    return relevantResultsForSeasons.some((item) => item.contentType === 'series' || item.contentType === 'reality');
  }, [relevantResultsForSeasons]);

  const seasonsList = useMemo(() => {
    if (!hasSeriesInActiveView) return [];
    const activeYears = filters.years;
    return uniqueNumbers(
      relevantResultsForSeasons
        .filter((item) => item.contentType === 'series' || item.contentType === 'reality')
        .flatMap((item) => {
          const itemSeasons = item.seasons && item.seasons.length > 0 ? item.seasons : (item.season ? [item.season] : []);
          const itemYears = item.years && item.years.length > 0 ? item.years : (item.year ? [item.year] : []);
          if (activeYears && activeYears.length > 0 && itemSeasons.length > 1 && itemYears.length > 1) {
            const matched: number[] = [];
            for (const y of activeYears) {
              const yIdx = itemYears.indexOf(y);
              if (yIdx >= 0 && yIdx < itemSeasons.length) {
                matched.push(itemSeasons[yIdx]);
              }
            }
            return matched;
          }
          return itemSeasons;
        })
    );
  }, [hasSeriesInActiveView, relevantResultsForSeasons, filters.years]);

  const relevantResultsForYears = useMemo(() => {
    const activeSeasons = filters.seasons;
    const activeContentTypes = filters.contentTypes;
    return results.filter((item) => {
      if (activeContentTypes && activeContentTypes.length > 0) {
        if (!activeContentTypes.includes(item.contentType as any)) return false;
      }
      if (activeSeasons && activeSeasons.length > 0) {
        const itemSeasons = item.seasons && item.seasons.length > 0 ? item.seasons : (item.season ? [item.season] : []);
        if (!itemSeasons.some((s) => activeSeasons.includes(s))) return false;
      }
      if (filters.providers?.length && !filters.providers.includes(item.providerId)) return false;
      if (filters.resolutions.length && !filters.resolutions.includes(item.resolution)) return false;
      return true;
    });
  }, [results, filters.contentTypes, filters.seasons, filters.providers, filters.resolutions]);

  const yearsList = useMemo(() => {
    return uniqueNumbers(
      relevantResultsForYears
        .flatMap((item) => item.years && item.years.length > 0 ? item.years : (item.year ? [item.year] : []))
    ).sort((a, b) => b - a);
  }, [relevantResultsForYears]);

  useEffect(() => {
    if (!hasSeriesInActiveView && (filters.seasons?.length ?? 0) > 0) {
      updateFilter('seasons', []);
    }
  }, [hasSeriesInActiveView, filters.seasons]);

  useEffect(() => {
    if (filters.years?.length && yearsList.length > 0) {
      if (!filters.years.some((y) => yearsList.includes(y))) {
        updateFilter('years', []);
      }
    } else if (filters.years?.length && yearsList.length === 0) {
      updateFilter('years', []);
    }
  }, [yearsList, filters.years]);

  const facets = useMemo(() => ({
    seasons: seasonsList,
    parts: uniqueNumbers(results.map((item) => item.part)),
    years: yearsList
  }), [seasonsList, results, yearsList]);

  const availableProviders = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) {
      if (!map.has(r.providerId)) {
        map.set(r.providerId, r.providerName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [results]);

  const providerLabels = useMemo(() => {
    return Object.fromEntries(availableProviders.map((p) => [p.id, p.name]));
  }, [availableProviders]);

  const runSearch = async (selectedQuery = query) => {
    setHistoryOpen(false);
    setTypingSuggestion(null);
    const clean = selectedQuery.replace(/\s+/gu, ' ').trim();
    if (clean.length < 3) { setToast('Введите минимум три символа для поиска.'); return; }
    if (requestId.current) await window.torrentApi.cancelSearch(requestId.current);
    const id = crypto.randomUUID();
    requestId.current = id;
    setQuery(clean);
    setSearching(true);
    setSearched(true);
    setResults([]);
    setPage(0);
    setStates([]);
    try {
      const response = await window.torrentApi.search({ requestId: id, query: clean, exact, contentType, page: 0 });
      if (requestId.current !== id || response.cancelled) return;
      const validResults = response.results.filter((item) => (item.seeds ?? 0) >= 1);
      setResults(validResults);
      setStates(response.providerStates);
      if (response.providerStates?.length) {
        setProviderCheckStates((prev) => {
          const next = [...prev];
          for (const s of response.providerStates) {
            const idx = next.findIndex((p) => p.id === s.id);
            if (idx >= 0) {
              next[idx] = { ...next[idx], status: s.status, message: s.message };
            } else {
              next.push(s);
            }
          }
          return next;
        });
      }
      setHistory(await window.torrentApi.getHistory());
    } catch {
      if (requestId.current === id) setToast('Не удалось выполнить поиск. Проверьте состояние источников.');
    } finally {
      if (requestId.current === id) { setSearching(false); requestId.current = null; }
    }
  };

  const cancelSearch = async () => {
    if (requestId.current) await window.torrentApi.cancelSearch(requestId.current);
    requestId.current = null;
    setSearching(false);
    setToast('Поиск отменён.');
  };

  const clearSearchResults = () => {
    if (requestId.current) {
      void window.torrentApi.cancelSearch(requestId.current);
      requestId.current = null;
    }
    resolvedTopicUrls.current.clear();
    setResults([]);
    setSearched(false);
    setSearching(false);
    setQuery('');
    setFilters(emptyFilters());
    setPage(0);
    setToast('Результаты поиска удалены.');
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => setFilters((previous) => ({ ...previous, [key]: value }));
  const toggle = <T,>(items: T[], value: T): T[] => items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
  const clearFilter = (key: keyof FilterState) => {
    updateFilter(key, [] as never);
  };

  const saveSettings = async (next: AppSettings, showToast = true) => {
    const saved = await window.torrentApi.saveSettings(next);
    setSettings(saved);
    if (showToast) {
      setToast('Настройки сохранены.');
    }
  };

  const openSettings = async () => {
    try {
      const fresh = await window.torrentApi.getDetectedApps();
      setDetectedApps(fresh);
    } catch {
      // ignore
    }
    setSettingsOpen(true);
  };

  const handleOpenMagnet = async (item: TorrentResult) => {
    try {
      const fresh = await window.torrentApi.getDetectedApps();
      setDetectedApps(fresh);
    } catch {
      // ignore
    }
    let magnet = item.magnetUrl;
    if (!magnet && item.pageUrl) {
      setToast('Получение magnet-ссылки…');
      const res = await window.torrentApi.resolveMagnet(item.pageUrl);
      if (res.ok && res.magnet) {
        magnet = res.magnet;
        item.magnetUrl = res.magnet;
      } else {
        setToast(res.error || 'Не удалось найти magnet-ссылку на странице');
        return;
      }
    }
    if (!magnet) {
      setToast('Magnet-ссылка недоступна для этой раздачи.');
      return;
    }

    const action = settings?.magnetAction || 'ask';
    if (action === 'ask') {
      setMagnetModal({ item, magnet });
    } else {
      const res = await window.torrentApi.openMagnetWith(magnet, action, item.title);
      setToast(res.ok ? 'Раздача запущена в выбранном приложении.' : (res.error || 'Ошибка запуска приложения'));
    }
  };

  const handlePlayInPlayer = async (item: TorrentResult) => {
    let magnet = item.magnetUrl;
    if (!magnet && item.pageUrl) {
      setToast('Получение magnet-ссылки…');
      const res = await window.torrentApi.resolveMagnet(item.pageUrl);
      if (res.ok && res.magnet) {
        magnet = res.magnet;
        item.magnetUrl = res.magnet;
      } else {
        setToast(res.error || 'Не удалось найти magnet-ссылку на странице');
        return;
      }
    }
    if (!magnet) {
      setToast('Magnet-ссылка недоступна для этой раздачи.');
      return;
    }

    const quickPlayer = settings?.quickPlayerApp || 'ask';
    if (quickPlayer === 'ask') {
      setMagnetModal({ item, magnet, onlyPlayers: true });
    } else {
      const res = await window.torrentApi.openMagnetWith(magnet, quickPlayer, item.title, false);
      const appName = detectedApps.find((a) => a.id === quickPlayer)?.name || 'плеере';
      setToast(res.ok ? `Запуск в ${appName}…` : (res.error || 'Ошибка запуска плеера'));
    }
  };

  const handleChooseMagnetApp = async (appId: string, remember: boolean) => {
    if (!magnetModal) return;
    const { magnet, item, onlyPlayers } = magnetModal;
    setMagnetModal(null);
    const res = await window.torrentApi.openMagnetWith(magnet, appId, item.title, false);
    if (remember && settings) {
      if (onlyPlayers) {
        const next = { ...settings, quickPlayerApp: appId };
        setSettings(next);
        void window.torrentApi.saveSettings(next);
      } else {
        const next = { ...settings, magnetAction: appId };
        setSettings(next);
        void window.torrentApi.saveSettings(next);
      }
    }
    const appName = detectedApps.find((a) => a.id === appId)?.name || 'приложении';
    setToast(res.ok ? `Раздача запущена в ${appName}.` : (res.error || 'Ошибка запуска приложения'));
  };

  const handleRemoveHistoryItem = async (e: React.MouseEvent, item: string) => {
    e.stopPropagation();
    const updated = await window.torrentApi.removeHistoryItem(item);
    setHistory(updated);
    if (updated.length === 0) {
      setHistoryOpen(false);
    }
  };

  const handleTitleMouseEnter = (item: TorrentResult, e: React.MouseEvent) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    currentHoveredId.current = item.id;
    const clientX = e.clientX;
    const clientY = e.clientY;

    hoverTimer.current = setTimeout(async () => {
      if (currentHoveredId.current !== item.id) return;
      setHoverPoster({
        item,
        x: clientX,
        y: clientY,
        url: undefined,
        loading: true
      });

      const url = await window.torrentApi.resolvePoster(item.title, item.year, item.pageUrl, item.contentType);
      if (currentHoveredId.current !== item.id) return;

      if (url) {
        setHoverPoster({
          item,
          x: clientX,
          y: clientY,
          url,
          loading: false
        });
      } else {
        setHoverPoster((prev) => (prev && prev.item.id === item.id ? { ...prev, loading: false } : prev));
      }
    }, 120);
  };

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelVoiceSearch = () => {
    if (vadTimerRef.current) {
      clearTimeout(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    audioChunksRef.current = [];
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }
    setIsRecording(false);
    setIsTranscribing(false);
    setAudioLevel(0);
  };

  const toggleVoiceSearch = async () => {
    if (isRecording || isTranscribing) {
      cancelVoiceSearch();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const liveAudioCtx = new AudioContextClass();
      const source = liveAudioCtx.createMediaStreamSource(stream);
      const analyser = liveAudioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const timeData = new Float32Array(analyser.fftSize);
      let speechDetected = false;
      let silenceStart: number | null = null;
      const startTime = Date.now();

      const SILENCE_AFTER_SPEECH_MS = 1200;
      const MAX_RECORDING_MS = 12000;
      const NO_SPEECH_TIMEOUT_MS = 6000;

      const checkAudioLevels = () => {
        if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
          return;
        }

        analyser.getFloatTimeDomainData(timeData);
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
          const val = timeData[i];
          sum += val * val;
        }
        const rms = Math.sqrt(sum / timeData.length);
        setAudioLevel(rms);
        const now = Date.now();

        const SPEECH_THRESHOLD = 0.015;
        const SILENCE_THRESHOLD = 0.009;

        if (rms > SPEECH_THRESHOLD) {
          speechDetected = true;
          silenceStart = null;
        } else if (speechDetected && rms < SILENCE_THRESHOLD) {
          if (silenceStart === null) {
            silenceStart = now;
          } else if (now - silenceStart >= SILENCE_AFTER_SPEECH_MS) {
            if (mediaRecorderRef.current.state === 'recording') {
              mediaRecorderRef.current.stop();
              return;
            }
          }
        } else if (!speechDetected && now - startTime >= NO_SPEECH_TIMEOUT_MS) {
          if (mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            return;
          }
        }

        if (now - startTime >= MAX_RECORDING_MS) {
          if (mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
            return;
          }
        }

        vadTimerRef.current = setTimeout(checkAudioLevels, 60);
      };

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (vadTimerRef.current) {
          clearTimeout(vadTimerRef.current);
          vadTimerRef.current = null;
        }
        try {
          await liveAudioCtx.close();
        } catch {
          // ignore
        }
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setAudioLevel(0);

        if (!speechDetected && audioChunksRef.current.length === 0) {
          setToast('Речь не обнаружена.');
          return;
        }

        setIsTranscribing(true);

        try {
          const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
          const arrayBuffer = await blob.arrayBuffer();
          const decodeCtx = new AudioContextClass();
          const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
          await decodeCtx.close();

          const targetSampleRate = 16000;
          const numChannels = decoded.numberOfChannels;
          let monoChannel: Float32Array;
          if (numChannels === 1) {
            monoChannel = decoded.getChannelData(0);
          } else {
            const ch0 = decoded.getChannelData(0);
            const ch1 = decoded.getChannelData(1);
            monoChannel = new Float32Array(ch0.length);
            for (let i = 0; i < ch0.length; i++) {
              monoChannel[i] = (ch0[i] + ch1[i]) / 2;
            }
          }

          const ratio = decoded.sampleRate / targetSampleRate;
          const targetLength = Math.round(monoChannel.length / ratio);
          const resampled = new Float32Array(targetLength);
          for (let i = 0; i < targetLength; i++) {
            const originalIndex = Math.min(Math.round(i * ratio), monoChannel.length - 1);
            resampled[i] = monoChannel[originalIndex];
          }

          const res = await window.torrentApi.transcribeAudio?.(Array.from(resampled));
          if (res?.ok && res.text) {
            const recognized = res.text.replace(/^[.,!?\s]+|[.,!?\s]+$/g, '').trim();
            if (recognized) {
              setQuery(recognized);
              setToast(`Распознано: "${recognized}"`);
              void runSearch(recognized);
            } else {
              setToast('Речь не распознана. Попробуйте ещё раз.');
            }
          } else {
            setToast(res?.error || 'Не удалось распознать речь.');
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setToast(`Ошибка обработки речи: ${msg}`);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      vadTimerRef.current = setTimeout(checkAudioLevels, 100);
    } catch {
      setToast('Не удалось получить доступ к микрофону. Проверьте разрешения.');
    }
  };

  const handleSetViewMode = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    try {
      localStorage.setItem('viewMode', mode);
    } catch {
      // ignore
    }
  };

  const isAnyModalOpen = settingsOpen || Boolean(magnetModal) || isRecording || isTranscribing || Boolean(detailTorrent);
  useEffect(() => {
    if (!isAnyModalOpen) return;
    document.body.classList.add('modal-open');
    const preventBgScroll = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.settings-modal, .magnet-modal, .auth-modal, .tv-detail-card')) {
        e.preventDefault();
      }
    };
    const preventBgKeys = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        const target = document.activeElement as HTMLElement | null;
        if (!target?.closest('.settings-modal, .magnet-modal, .auth-modal, .tv-detail-card') && !['input', 'textarea', 'select'].includes(target?.tagName?.toLowerCase() || '')) {
          e.preventDefault();
        }
      }
    };
    window.addEventListener('wheel', preventBgScroll, { passive: false });
    window.addEventListener('keydown', preventBgKeys, { passive: false });
    return () => {
      document.body.classList.remove('modal-open');
      window.removeEventListener('wheel', preventBgScroll);
      window.removeEventListener('keydown', preventBgKeys);
    };
  }, [isAnyModalOpen]);

  const handleTitleMouseLeave = () => {
    currentHoveredId.current = null;
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setHoverPoster(null);
  };

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand">
        <span>Поисковик торрентов</span>
      </div>
      <div className="search-section-wrap" ref={searchWrapRef}>
        <button
          type="button"
          className={`tv-voice-btn ${isRecording ? 'recording' : ''} ${isTranscribing ? 'transcribing' : ''}`}
          onClick={() => void toggleVoiceSearch()}
          title={isRecording ? 'Остановить запись' : isTranscribing ? 'Распознавание…' : 'Голосовой поиск (назовите фильм)'}
          aria-label={isRecording ? 'Остановить запись' : 'Голосовой поиск'}
          disabled={isTranscribing}
        >
          <svg viewBox="0 0 24 24" width="27" height="27" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        </button>

        <div className="search-input-wrap">
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              setHistoryOpen(false);
              setTypingSuggestion(null);
              void runSearch();
            }}
          >
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (historyOpen) setHistoryOpen(false);
              }}
              onKeyDown={(event) => {
                if (typingSuggestion) {
                  if (event.key === 'Tab') {
                    event.preventDefault();
                    const targetQuery = typingSuggestion;
                    setQuery(targetQuery);
                    setTypingSuggestion(null);
                    void runSearch(targetQuery);
                  } else if (event.key === 'Escape') {
                    setDismissedQuery(query.trim());
                    setTypingSuggestion(null);
                  }
                }
              }}
              onFocus={() => { if (history.length > 0 && !typingSuggestion) setHistoryOpen(true); }}
              onDoubleClick={() => { if (history.length > 0) setHistoryOpen(true); }}
              placeholder="Название фильма, сериала или шоу"
              aria-label="Поисковый запрос"
              autoComplete="off"
            />
            {history.length > 0 && (
              <button
                type="button"
                className="history-toggle-btn"
                onClick={() => setHistoryOpen((prev) => !prev)}
                title={historyOpen ? 'Закрыть историю' : 'История поисков'}
                aria-label={historyOpen ? 'Закрыть историю' : 'История поисков'}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`history-chevron ${historyOpen ? 'open' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
            <button className="primary" type="submit" disabled={searching}>{searching ? 'Ищем…' : 'Найти'}</button>
          </form>

        {typingSuggestion && !historyOpen && (
          <div className="search-suggestion-bar" role="alert">
            <div className="suggestion-content">
              <span className="suggestion-icon" aria-hidden="true">💡</span>
              <span className="suggestion-text">
                Возможно, вы имели в виду:{' '}
                <button
                  type="button"
                  className="suggestion-highlight-btn"
                  onClick={() => {
                    const targetQuery = typingSuggestion;
                    setQuery(targetQuery);
                    setTypingSuggestion(null);
                    void runSearch(targetQuery);
                  }}
                  title="Искать исправленное название"
                >
                  {typingSuggestion}
                </button>
              </span>
            </div>
            <div className="suggestion-actions">
              <button
                type="button"
                className="suggestion-btn apply"
                onClick={() => {
                  const targetQuery = typingSuggestion;
                  setQuery(targetQuery);
                  setTypingSuggestion(null);
                  void runSearch(targetQuery);
                }}
                title="Искать по исправленному названию (клавиша Tab)"
              >
                Искать «{typingSuggestion}»
              </button>
              <button
                type="button"
                className="suggestion-btn dismiss"
                onClick={() => {
                  setDismissedQuery(query.trim());
                  setTypingSuggestion(null);
                }}
                title="Оставить введённый вариант и закрыть подсказку (Esc)"
              >
                Оставить мой вариант
              </button>
            </div>
          </div>
        )}

        {historyOpen && history.length > 0 && (
          <div className="search-history-dropdown" role="listbox">
            <div className="history-dropdown-header">
              <span>История поиска</span>
              <button
                type="button"
                className="clear-all-history-btn"
                onClick={async () => {
                  await window.torrentApi.clearHistory();
                  setHistory([]);
                  setHistoryOpen(false);
                }}
              >
                Очистить всю
              </button>
            </div>
            <div className="history-dropdown-list">
              {history.map((item) => (
                <div
                  key={item}
                  className="history-item"
                  onClick={() => {
                    setQuery(item);
                    setHistoryOpen(false);
                    void runSearch(item);
                  }}
                >
                  <span className="history-item-icon">🕒</span>
                  <span className="history-item-text">{item}</span>
                  <button
                    type="button"
                    className="history-item-delete"
                    onClick={(e) => void handleRemoveHistoryItem(e, item)}
                    title="Удалить этот запрос из истории"
                    aria-label={`Удалить ${item} из истории`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
      <button className="icon-button" type="button" onClick={() => void openSettings()} title="Настройки" aria-label="Настройки">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>

    <section className="query-controls" aria-label="Режим поиска">
      <div className="segmented" role="group" aria-label="Режим поиска">
        <button className={!exact ? 'selected' : ''} onClick={() => setExact(false)} type="button">Обычный</button>
        <button className={exact ? 'selected' : ''} onClick={() => setExact(true)} type="button">Точный</button>
      </div>
      {searching && <button className="text-button danger" onClick={() => void cancelSearch()} type="button">Отменить поиск</button>}
      <StatusSummary providerStates={providerCheckStates} searching={searching} checking={checkingProviders} />
    </section>

    {results.length > 0 && (
      <div className="sticky-controls">
        <section className="filter-panel">
          <div className="filter-groups-left">
            <FilterGroup
              title="Тип контента"
              values={contentTypeFilterValues}
              labels={contentTypeFilterLabels}
              active={filters.contentTypes ?? []}
              onToggle={(value) => {
                const current = filters.contentTypes ?? [];
                const next = current.includes(value) ? [] : [value];
                updateFilter('contentTypes', next);
                if (next.includes('movie')) {
                  updateFilter('seasons', []);
                }
              }}
            />
            <FilterGroup title="Разрешение видео" values={(['480p', '720p', '1080p', '2160p'] as Resolution[])} labels={resolutionLabels} active={filters.resolutions} onToggle={(value) => updateFilter('resolutions', filters.resolutions.includes(value) ? [] : [value])} />
            <FilterGroup title="Динамический диапазон" values={(['sdr', 'hdr', 'dolby-vision'] as DynamicRange[])} labels={rangeLabels} active={filters.dynamicRanges} onToggle={(value) => updateFilter('dynamicRanges', filters.dynamicRanges.includes(value) ? [] : [value])} />
            {availableProviders.length > 0 && (
              <ProviderDropdown
                providers={availableProviders}
                activeProvider={filters.providers?.[0]}
                labels={providerLabels}
                onSelect={(providerId) => updateFilter('providers', providerId ? [providerId] : [])}
              />
            )}
            {facets.years.length > 0 && (
              <YearDropdown
                years={facets.years}
                activeYear={filters.years?.[0]}
                onSelect={(year) => updateFilter('years', year ? [year] : [])}
              />
            )}
            {facets.seasons.length > 0 && (
              <SeasonDropdown
                seasons={facets.seasons}
                activeSeason={filters.seasons?.[0]}
                onSelect={(season) => updateFilter('seasons', season ? [season] : [])}
              />
            )}
            {facets.parts.length > 0 && <FilterGroup title="Часть" values={facets.parts} labels={Object.fromEntries(facets.parts.map((part) => [part, `Часть ${part}`]))} active={filters.parts} onToggle={(value) => updateFilter('parts', toggle(filters.parts, value))} />}
          </div>
          <button
            type="button"
            className="clear-search-btn"
            onClick={clearSearchResults}
            disabled={!searched && results.length === 0 && !query}
            title="Очистить поисковый запрос и результаты"
          >
            Удалить результаты
          </button>
        </section>

        <section className="results-toolbar">
          <div className="results-toolbar-left">
            <span className="results-count">
              <strong style={{ display: 'inline-block', marginRight: `${String(visible.length).length <= 2 ? 8 : String(visible.length).length === 3 ? 10 : 13}px` }}>
                {visible.length}
              </strong>
              <span style={{ display: 'inline-block', marginRight: '5px' }}>из</span>
              {results.length} раздач
              {totalPages > 1 && ` (страница ${currentPage + 1} из ${totalPages}, показаны ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, visible.length)})`}
              {searched && results.length === 0 ? ' — ничего не найдено' : ''}
            </span>
            <ActiveFilters filters={filters} providerLabels={providerLabels} onClear={clearFilter} onReset={() => setFilters(emptyFilters())} />
          </div>
          <div className="results-toolbar-right">
            <div className="view-mode-toggle segmented" role="group" aria-label="Режим отображения">
              <button
                type="button"
                className={viewMode === 'list' ? 'selected' : ''}
                onClick={() => handleSetViewMode('list')}
                title="Отображение списком"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
                <span>Список</span>
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? 'selected' : ''}
                onClick={() => handleSetViewMode('grid')}
                title="Отображение таблицей (плитки с постерами)"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="3" width="7" height="7" rx="1.5"/>
                  <rect x="14" y="14" width="7" height="7" rx="1.5"/>
                  <rect x="3" y="14" width="7" height="7" rx="1.5"/>
                </svg>
                <span>Таблица</span>
              </button>
            </div>
            <div className="sort-controls">
              <label>
                Сортировка{' '}
                <select
                  value={sort.field}
                  onChange={(event) => {
                    const nextField = event.target.value as SortState['field'];
                    setSort({
                      field: nextField,
                      direction: nextField === 'title' ? 'asc' : 'desc'
                    });
                  }}
                >
                  <option value="relevance">По релевантности</option>
                  <option value="seeds">По сидам</option>
                  <option value="size">По размеру</option>
                  <option value="published">По дате публикации</option>
                  <option value="updated">По дате обновления</option>
                  <option value="title">По названию</option>
                </select>
              </label>
              <button
                type="button"
                className="direction"
                onClick={() => setSort((previous) => ({ ...previous, direction: previous.direction === 'asc' ? 'desc' : 'asc' }))}
                title="Изменить направление"
              >
                {sort.direction === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </section>
      </div>
    )}
    {(searched || results.length > 0) && (
      <div className="results-viewport" ref={resultsViewportRef}>
        {viewMode === 'grid' ? (
          <ResultsGrid
            results={pagedResults}
            activeYear={filters.years?.[0]}
            onSelect={(item) => setDetailTorrent(item)}
            onPlayInPlayer={handlePlayInPlayer}
            sharedHeight={sharedHeight}
          />
        ) : (
          <ResultsTable
            results={pagedResults}
            activeYear={filters.years?.[0]}
            onToast={setToast}
            onOpenMagnet={handleOpenMagnet}
            onTitleMouseEnter={handleTitleMouseEnter}
            onTitleMouseLeave={handleTitleMouseLeave}
            sharedHeight={sharedHeight}
          />
        )}
      </div>
    )}
    {searched && totalPages > 1 && (
      <nav className="pagination" aria-label="Страницы результатов">
        <button
          className="page"
          type="button"
          disabled={currentPage === 0}
          onClick={() => { setPage((p) => Math.max(0, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          title="Предыдущая страница"
        >
          ‹
        </button>
        {getPageList(currentPage, totalPages).map((item, idx) =>
          item === '...' ? (
            <span key={`dots-${idx}`} className="page-dots">…</span>
          ) : (
            <button
              key={item}
              className={item === currentPage ? 'page active' : 'page'}
              type="button"
              onClick={() => { setPage(item as number); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            >
              {(item as number) + 1}
            </button>
          )
        )}
        <button
          className="page"
          type="button"
          disabled={currentPage >= totalPages - 1}
          onClick={() => { setPage((p) => Math.min(totalPages - 1, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          title="Следующая страница"
        >
          ›
        </button>
      </nav>
    )}
    {!searched && (
      <EmptyState
        icon={
          <svg className="search-mag-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <line x1="21" y1="21" x2="15.2" y2="15.2" />
          </svg>
        }
        title="Начните поиск!"
        isInitial
      />
    )}
    {searched && !searching && results.length === 0 && (
      <EmptyState
        icon="◌"
        title="Раздачи не найдены"
        description="Источники могли быть недоступны или не содержать русскоязычных метаданных. Проверьте их в настройках."
        suggestedQuery={didYouMean}
        onApplySuggestion={(corrected) => {
          setQuery(corrected);
          void runSearch(corrected);
        }}
      />
    )}
    {searched && !searching && results.length > 0 && visible.length === 0 && <EmptyState icon="⊘" title="Фильтры скрыли все результаты" description="Сбросьте отдельный фильтр выше или очистите их все." />}
    {settingsOpen && settings && (
      <SettingsDialog
        settings={settings}
        states={providerCheckStates}
        detectedApps={detectedApps}
        checking={checkingProviders}
        onCheckProviders={checkProvidersAvailability}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettings}
        onSettingsUpdated={(next) => setSettings(next)}
        onToast={setToast}
      />
    )}
    {magnetModal && (
      <MagnetActionModal
        item={magnetModal.item}
        apps={detectedApps}
        onlyPlayers={magnetModal.onlyPlayers}
        onClose={() => setMagnetModal(null)}
        onSelect={handleChooseMagnetApp}
      />
    )}
    {detailTorrent && (
      <TorrentDetailModal
        item={detailTorrent}
        activeYear={filters.years?.[0]}
        onClose={() => setDetailTorrent(null)}
        onOpenMagnet={handleOpenMagnet}
        onToast={setToast}
      />
    )}
    {(isRecording || isTranscribing) && (
      <VoiceSearchModal
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        audioLevel={audioLevel}
        onCancel={cancelVoiceSearch}
      />
    )}
    <PosterTooltip data={hoverPoster} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}

function StatusSummary({
  providerStates,
  searching,
  checking
}: {
  providerStates: ProviderState[];
  searching: boolean;
  checking: boolean;
}) {
  if (searching) {
    return <span className="status searching"><i />Идёт поиск…</span>;
  }
  if (checking) {
    const okCount = providerStates.filter((s) => s.status === 'ok').length;
    return (
      <span className="status checking">
        <i />Проверка источников… {okCount > 0 ? `(готово: ${okCount})` : ''}
      </span>
    );
  }
  if (!providerStates.length) {
    return <span className="status">Источники ещё не проверялись</span>;
  }

  const okList = providerStates.filter((s) => s.status === 'ok');
  const errorList = providerStates.filter((s) => s.status === 'error');
  const total = providerStates.length;

  if (errorList.length === 0) {
    return (
      <span className="status ok" title={okList.map((s) => `✓ ${s.name}`).join('\n')}>
        Доступно источников: {okList.length} из {total}
      </span>
    );
  }

  const failedNames = errorList.map((s) => s.name).join(', ');
  const single = errorList.length === 1;

  return (
    <span
      className="status error"
      title={errorList.map((s) => `✗ ${s.name}: ${s.message || 'Недоступен'}`).join('\n')}
    >
      Доступно: {okList.length} из {total} · {single ? 'Недоступен' : 'Недоступны'}: <strong className="bad-provider-name">{failedNames}</strong>
    </span>
  );
}

function YearDropdown({
  years,
  activeYear,
  onSelect
}: {
  years: number[];
  activeYear?: number;
  onSelect(year?: number): void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="year-dropdown-wrap" ref={containerRef}>
      <span className="filter-label">Год</span>
      <button
        type="button"
        className={`chip dropdown-trigger ${activeYear ? 'active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Выбрать год выхода из выпадающего списка"
      >
        <span>{activeYear ? String(activeYear) : 'Все'}</span>
        <span className="dropdown-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="year-dropdown-menu" role="listbox">
          <button
            type="button"
            className={`year-dropdown-item ${!activeYear ? 'selected' : ''}`}
            onClick={() => {
              onSelect(undefined);
              setOpen(false);
            }}
          >
            Все года
          </button>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              className={`year-dropdown-item ${activeYear === y ? 'selected' : ''}`}
              onClick={() => {
                onSelect(activeYear === y ? undefined : y);
                setOpen(false);
              }}
            >
              {y}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SeasonDropdown({
  seasons,
  activeSeason,
  onSelect
}: {
  seasons: number[];
  activeSeason?: number;
  onSelect(season?: number): void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="year-dropdown-wrap" ref={containerRef}>
      <span className="filter-label">Сезон</span>
      <button
        type="button"
        className={`chip dropdown-trigger ${activeSeason ? 'active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Выбрать сезон из выпадающего списка"
      >
        <span>{activeSeason ? `Сезон ${activeSeason}` : 'Все'}</span>
        <span className="dropdown-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="year-dropdown-menu" role="listbox">
          <button
            type="button"
            className={`year-dropdown-item ${!activeSeason ? 'selected' : ''}`}
            onClick={() => {
              onSelect(undefined);
              setOpen(false);
            }}
          >
            Все сезоны
          </button>
          {seasons.map((s) => (
            <button
              key={s}
              type="button"
              className={`year-dropdown-item ${activeSeason === s ? 'selected' : ''}`}
              onClick={() => {
                onSelect(activeSeason === s ? undefined : s);
                setOpen(false);
              }}
            >
              Сезон {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderDropdown({
  providers,
  activeProvider,
  labels,
  onSelect
}: {
  providers: Array<{ id: string; name: string }>;
  activeProvider?: string;
  labels: Record<string, string>;
  onSelect(providerId?: string): void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="year-dropdown-wrap" ref={containerRef}>
      <span className="filter-label">Источник</span>
      <button
        type="button"
        className={`chip dropdown-trigger ${activeProvider ? 'active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Выбрать источник из выпадающего списка"
      >
        <span>{activeProvider ? (labels[activeProvider] || activeProvider) : 'Все'}</span>
        <span className="dropdown-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="year-dropdown-menu" role="listbox">
          <button
            type="button"
            className={`year-dropdown-item ${!activeProvider ? 'selected' : ''}`}
            onClick={() => {
              onSelect(undefined);
              setOpen(false);
            }}
          >
            Все источники
          </button>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`year-dropdown-item ${activeProvider === p.id ? 'selected' : ''}`}
              onClick={() => {
                onSelect(activeProvider === p.id ? undefined : p.id);
                setOpen(false);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterGroup<T extends string | number>({ title, values, labels, active, onToggle }: { title: string; values: T[]; labels: Record<string | number, string>; active: T[]; onToggle(value: T): void }) {
  return <div className="filter-group"><span className="filter-label">{title}</span>{values.map((value) => <button type="button" className={active.includes(value) ? 'chip active' : 'chip'} onClick={() => onToggle(value)} key={value}>{labels[value]}</button>)}</div>;
}

function ActiveFilters({
  filters,
  providerLabels = {},
  onClear,
  onReset
}: {
  filters: FilterState;
  providerLabels?: Record<string, string>;
  onClear(key: keyof FilterState): void;
  onReset(): void;
}) {
  const current: Array<[keyof FilterState, string]> = [
    ['contentTypes', (filters.contentTypes ?? []).map((ct) => contentTypeFilterLabels[ct] || ct).join(', ')],
    ['resolutions', filters.resolutions.join(', ')],
    ['dynamicRanges', filters.dynamicRanges.map((range) => rangeLabels[range]).join(', ')],
    ['providers', (filters.providers ?? []).map((p) => providerLabels[p] || p).join(', ')],
    ['years', (filters.years ?? []).map((y) => String(y)).join(', ')],
    ['seasons', filters.seasons.map((season) => `Сезон ${season}`).join(', ')],
    ['parts', filters.parts.map((part) => `Часть ${part}`).join(', ')]
  ].filter(([, label]) => label) as Array<[keyof FilterState, string]>;
  if (!current.length) return null;
  return <div className="active-filters"><span>Активные фильтры:</span>{current.map(([key, label]) => <button type="button" key={key} onClick={() => onClear(key)}>{label} <b>×</b></button>)}<button className="reset" type="button" onClick={onReset}>Сбросить все</button></div>;
}

function ResultsGrid({
  results,
  activeYear,
  onSelect,
  onPlayInPlayer,
  sharedHeight
}: {
  results: TorrentResult[];
  activeYear?: number;
  onSelect(item: TorrentResult): void;
  onPlayInPlayer(item: TorrentResult): void;
  sharedHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const GAP = 22;
  const PADDING_V = 28;
  const [cardHeight, setCardHeight] = useState<number>(() => {
    const initH = sharedHeight ?? 700;
    return Math.max(220, Math.floor((initH - GAP - PADDING_V) / 2));
  });
  const [containerHeight, setContainerHeight] = useState<number | undefined>(sharedHeight);

  useEffect(() => {
    if (sharedHeight) {
      setContainerHeight(sharedHeight);
      setCardHeight(Math.max(220, Math.floor((sharedHeight - GAP - PADDING_V) / 2)));
    }
  }, [sharedHeight]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const bottomReserve = 58;
      const available = Math.max(380, window.innerHeight - rect.top - bottomReserve);
      const computedCard = Math.max(220, Math.floor((available - GAP - PADDING_V) / 2));
      const computedContainer = computedCard * 2 + GAP + PADDING_V;
      setCardHeight(computedCard);
      setContainerHeight(computedContainer);
    };

    measure();
    const raf1 = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 150);

    const observer = new ResizeObserver(() => {
      measure();
    });
    if (el.parentElement) {
      observer.observe(el.parentElement);
    }
    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [results]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 10) return;
      e.preventDefault();
      if (isScrollingRef.current) return;

      const rowDistance = (cardHeight + GAP) * 2;
      const currentScroll = el.scrollTop;
      const currentScreen = Math.round(currentScroll / rowDistance);
      const targetScreen = e.deltaY > 0 ? currentScreen + 1 : currentScreen - 1;
      const maxScroll = el.scrollHeight - el.clientHeight;
      const maxScreen = Math.ceil(maxScroll / rowDistance);
      const clampedScreen = Math.max(0, Math.min(maxScreen, targetScreen));
      const targetScroll = Math.min(maxScroll, clampedScreen * rowDistance);

      isScrollingRef.current = true;
      el.scrollTo({ top: targetScroll, behavior: 'smooth' });
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 350);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cardHeight, GAP]);

  return (
    <div
      ref={containerRef}
      className="results-grid-container"
      style={containerHeight ? { height: `${containerHeight}px`, maxHeight: `${containerHeight}px` } : undefined}
    >
      <div className="results-grid">
        {results.map((item) => (
          <GridCard
            key={item.id}
            item={item}
            cardHeight={cardHeight}
            activeYear={activeYear}
            onSelect={() => onSelect(item)}
            onPlayInPlayer={() => onPlayInPlayer(item)}
          />
        ))}
      </div>
    </div>
  );
}

function GridCard({
  item,
  cardHeight,
  activeYear,
  onSelect,
  onPlayInPlayer
}: {
  item: TorrentResult;
  cardHeight?: number;
  activeYear?: number;
  onSelect(): void;
  onPlayInPlayer(): void;
}) {
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void window.torrentApi.resolvePoster(item.title, item.year, item.pageUrl, item.contentType).then((url) => {
      if (active && url) {
        setPosterUrl(url);
      }
    });
    return () => {
      active = false;
    };
  }, [item.title, item.year, item.pageUrl, item.contentType]);

  return (
    <div
      className="results-grid-card"
      style={cardHeight ? { height: `${cardHeight}px` } : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      title={`Открыть карточку «${item.title}»`}
    >
      <div className="card-poster-wrap">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={item.title}
            className={`card-poster-img ${imgLoaded ? 'loaded' : ''}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setPosterUrl(null)}
          />
        ) : (
          <div className="card-poster-fallback">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
              <line x1="7" y1="2" x2="7" y2="22"/>
              <line x1="17" y1="2" x2="17" y2="22"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <line x1="2" y1="7" x2="7" y2="7"/>
              <line x1="2" y1="17" x2="7" y2="17"/>
              <line x1="17" y1="17" x2="22" y2="17"/>
              <line x1="17" y1="7" x2="22" y2="7"/>
            </svg>
            <span className="fallback-type">{formatReleaseSubline(item, activeYear)}</span>
          </div>
        )}

        <div className="card-top-chips">
          {item.resolution !== 'unknown' && (
            <span className={`card-badge quality ${item.resolution === '2160p' ? 'uhd' : ''}`}>
              {resolutionLabels[item.resolution]}
            </span>
          )}
          <span className="card-badge provider">
            {item.providerName}
          </span>
        </div>

        <button
          type="button"
          className="card-quick-play-btn"
          onClick={(e) => {
            e.stopPropagation();
            onPlayInPlayer();
          }}
          title="Проиграть в плеере"
          aria-label="Проиграть в плеере"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      </div>

      <div className="card-caption">
        <h4 className="card-title" title={item.title}>{item.title}</h4>
        <div className="card-subline">
          <span>{formatReleaseSubline(item, activeYear)}</span>
          <span className="card-size">{item.sizeLabel}</span>
        </div>
        <div className="card-meta-line">
          <div className="card-meta-left">
            {item.dynamicRange && item.dynamicRange !== 'unknown' && (
              <span className={`card-range-badge ${item.dynamicRange === 'dolby-vision' ? 'dv' : item.dynamicRange === 'sdr' ? 'sdr' : 'hdr'}`}>
                {rangeLabels[item.dynamicRange]}
              </span>
            )}
          </div>
          <div className="card-meta-right">
            <span className="card-seeds" title={`${item.seeds ?? 0} сидов`}>
              ▲ {item.seeds ?? 0}
            </span>
            {item.leeches !== undefined && (
              <span className="card-leeches" title={`${item.leeches} личей`}>
                ▼ {item.leeches}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TorrentDetailModal({
  item,
  activeYear,
  onClose,
  onOpenMagnet,
  onToast
}: {
  item: TorrentResult;
  activeYear?: number;
  onClose(): void;
  onOpenMagnet(item: TorrentResult): void;
  onToast(msg: string): void;
}) {
  const cacheKey = getRatingCacheKey(item.title, item.year, item.contentType);
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [ratings, setRatings] = useState<FilmRatings | null>(() => globalRatingsCache.get(cacheKey) ?? null);
  const [ratingsLoading, setRatingsLoading] = useState(() => !globalRatingsCache.has(cacheKey));

  useEffect(() => {
    let active = true;
    void window.torrentApi.resolvePoster(item.title, item.year, item.pageUrl, item.contentType).then((url) => {
      if (active && url) {
        setPosterUrl(url);
      }
    });
    return () => { active = false; };
  }, [item.title, item.year, item.pageUrl, item.contentType]);

  useEffect(() => {
    let active = true;
    if (globalRatingsCache.has(cacheKey)) {
      setRatings(globalRatingsCache.get(cacheKey) ?? null);
      setRatingsLoading(false);
      return;
    }
    setRatingsLoading(true);
    void window.torrentApi.resolveRatings?.(item.title, item.year, item.pageUrl, item.contentType).then((r) => {
      globalRatingsCache.set(cacheKey, r ?? null);
      if (active) {
        setRatings(r ?? null);
        setRatingsLoading(false);
      }
    });
    return () => { active = false; };
  }, [cacheKey, item.title, item.year, item.contentType]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCopyMagnet = async () => {
    let magnet = item.magnetUrl;
    if (!magnet && item.pageUrl) {
      onToast('Получение magnet-ссылки…');
      const res = await window.torrentApi.resolveMagnet(item.pageUrl);
      if (res.ok && res.magnet) {
        magnet = res.magnet;
        item.magnetUrl = res.magnet;
      } else {
        onToast(res.error || 'Не удалось найти magnet-ссылку на странице');
        return;
      }
    }
    if (magnet) {
      const res = await window.torrentApi.copyMagnet(magnet);
      onToast(res.ok ? 'Magnet-ссылка скопирована.' : res.error || 'Не удалось скопировать magnet-ссылку');
    } else {
      onToast('Magnet-ссылка недоступна для этой раздачи.');
    }
  };

  const displayCountry = ratings?.country || extractCountry(item.rawTitle);

  return (
    <div className="tv-detail-backdrop" onClick={onClose} role="presentation">
      <div
        className="tv-detail-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={item.title}
      >
        {posterUrl && (
          <>
            <div
              className="tv-media-backdrop-bg"
              style={{ backgroundImage: `url(${posterUrl})` }}
            />
            <div className="tv-media-backdrop-gradient" />
          </>
        )}
        <button type="button" className="tv-modal-close" onClick={onClose} aria-label="Закрыть">×</button>

        <div className="tv-detail-left">
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={item.title}
              className="tv-detail-poster"
              onError={() => setPosterUrl(null)}
            />
          ) : (
            <div className="tv-detail-poster-fallback">
              <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                <line x1="7" y1="2" x2="7" y2="22"/>
                <line x1="17" y1="2" x2="17" y2="22"/>
                <line x1="2" y1="12" x2="22" y2="12"/>
                <line x1="2" y1="7" x2="7" y2="7"/>
                <line x1="2" y1="17" x2="7" y2="17"/>
                <line x1="17" y1="17" x2="22" y2="17"/>
                <line x1="17" y1="7" x2="22" y2="7"/>
              </svg>
              <span>Постер не найден</span>
            </div>
          )}
        </div>

        <div className="tv-detail-right">
          <div className="tv-detail-meta-top">
            <span className="tv-badge-type">{contentLabels[item.contentType]}</span>
            {(() => {
              const minYear = item.years && item.years.length > 0 ? Math.min(...item.years) : item.year;
              const maxYear = item.years && item.years.length > 0 ? Math.max(...item.years) : item.year;
              const rangeStr = minYear !== undefined && maxYear !== undefined && minYear !== maxYear ? `${minYear}–${maxYear}` : (item.year ? String(item.year) : null);
              return rangeStr ? <span className="tv-meta-dot">• {rangeStr}</span> : null;
            })()}
            {displayCountry && <span className="tv-meta-dot">• {displayCountry}</span>}
          </div>

          <h2 className="tv-detail-title">{item.title}</h2>
          <div className="tv-detail-subline">{formatReleaseSubline(item, activeYear)}</div>

          <div className="tv-specs-grid">
            <div className="tv-spec-item">
              <span className="tv-spec-label">Разрешение</span>
              <span className="tv-spec-val highlight">{resolutionLabels[item.resolution]}</span>
            </div>
            <div className="tv-spec-item">
              <span className="tv-spec-label">Динамический диапазон</span>
              <span className="tv-spec-val">{rangeLabels[item.dynamicRange]}</span>
            </div>
            <div className="tv-spec-item">
              <span className="tv-spec-label">Размер</span>
              <span className="tv-spec-val">{item.sizeLabel}</span>
            </div>
            <div className="tv-spec-item">
              <span className="tv-spec-label">Раздают / Качают</span>
              <span className="tv-spec-val">
                <span className="seeds">▲ {item.seeds ?? 0}</span> / <span className="leeches">▼ {item.leeches ?? 0}</span>
              </span>
            </div>
            <div className="tv-spec-item">
              <span className="tv-spec-label">Опубликовано</span>
              <span className="tv-spec-val">{formatDate(item.publishedAt)}</span>
            </div>
            <div className="tv-spec-item">
              <span className="tv-spec-label">Источник</span>
              <span className="tv-spec-val provider">{item.providerName}</span>
            </div>
          </div>

          <div className="tv-ratings-box">
            <div className="tv-rating-card kp">
              <div className="tv-rating-col-left">
                <span className="tv-rating-logo kp">КИНОПОИСК</span>
                <div className="tv-rating-score-left">
                  {ratings?.kpNotFormed ? null : <span className="tv-rating-star kp">★</span>}
                  <span
                    className={`tv-rating-num ${ratings?.kpNotFormed ? 'not-formed' : parseFloat(ratings?.kp || '0') >= 7 ? 'good' : ''}`}
                    title={ratings?.kpNotFormed ? 'Рейтинг на Кинопоиске ещё не сформирован' : undefined}
                  >
                    {ratingsLoading ? '…' : (ratings?.kp || '—')}
                  </span>
                </div>
              </div>
              <div className="tv-rating-col-right">
                <span className="tv-rating-votes">{ratings?.kpVotes ? `${ratings.kpVotes} оценок` : ''}</span>
                <button
                  type="button"
                  className="tv-rating-reviews-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    const url = ratings?.kpReviewsUrl || `https://www.kinopoisk.ru/index.php?kp_query=${encodeURIComponent(item.title)}`;
                    void window.torrentApi.openExternal(url);
                  }}
                  title="Открыть отзывы на Кинопоиске в браузере"
                >
                  Отзывы
                </button>
              </div>
            </div>

            <div className="tv-rating-card imdb">
              <div className="tv-rating-col-left">
                <span className="tv-rating-logo imdb">IMDb</span>
                <div className="tv-rating-score-left">
                  <span className="tv-rating-star imdb">★</span>
                  <span className={`tv-rating-num ${parseFloat(ratings?.imdb || '0') >= 7 ? 'good' : ''}`}>
                    {ratingsLoading ? '…' : (ratings?.imdb || '—')}
                  </span>
                </div>
              </div>
              <div className="tv-rating-col-right">
                <span className="tv-rating-votes">{ratings?.imdbVotes ? `${ratings.imdbVotes} оценок` : ''}</span>
                <button
                  type="button"
                  className="tv-rating-reviews-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    const url = ratings?.imdbReviewsUrl || `https://www.imdb.com/find/?q=${encodeURIComponent(item.title)}&s=tt`;
                    void window.torrentApi.openExternal(url);
                  }}
                  title="Открыть отзывы на IMDb в браузере"
                >
                  Отзывы
                </button>
              </div>
            </div>
          </div>

          <div className="tv-action-buttons">
            <button
              type="button"
              className="tv-btn tv-btn-primary"
              onClick={() => {
                onOpenMagnet(item);
              }}
              title="Запустить воспроизведение или скачивание"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Открыть раздачу</span>
            </button>

            <button
              type="button"
              className="tv-btn tv-btn-secondary"
              onClick={() => void handleCopyMagnet()}
              title="Скопировать magnet-ссылку в буфер обмена"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Копировать Magnet</span>
            </button>

            <button
              type="button"
              className="tv-btn tv-btn-secondary"
              onClick={() => void window.torrentApi.openExternal(item.pageUrl)}
              title="Открыть в браузере страницу на трекере"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              <span>Перейти на трекер</span>
            </button>

            {item.torrentUrl ? (
              <button
                type="button"
                className="tv-btn tv-btn-secondary"
                onClick={async () => {
                  const res = await window.torrentApi.downloadTorrent(item.torrentUrl!, item.title);
                  onToast(res.ok ? 'Торрент-файл сохранён.' : res.error || 'Ошибка загрузки .torrent');
                }}
                title="Скачать торрент-файл"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Скачать торрент-файл</span>
              </button>
            ) : (
              <button
                type="button"
                className="tv-btn tv-btn-secondary disabled"
                disabled
                title="Прямая ссылка на торрент-файл недоступна"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                <span>Скачать торрент-файл</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultsTable({
  results,
  activeYear,
  onToast,
  onOpenMagnet,
  onTitleMouseEnter,
  onTitleMouseLeave,
  sharedHeight
}: {
  results: TorrentResult[];
  activeYear?: number;
  onToast(value: string): void;
  onOpenMagnet(item: TorrentResult): void;
  onTitleMouseEnter(item: TorrentResult, e: React.MouseEvent): void;
  onTitleMouseLeave(): void;
  sharedHeight?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const HEADER_HEIGHT = 38;
  const BORDER_V = 2;
  const [tableHeight, setTableHeight] = useState<number | undefined>(sharedHeight);
  const [rowHeight, setRowHeight] = useState<number>(() => {
    const initH = sharedHeight ?? 700;
    const target = initH - HEADER_HEIGHT - BORDER_V;
    const rows = Math.max(3, Math.round(target / 48));
    return target / rows;
  });

  useEffect(() => {
    if (sharedHeight) {
      setTableHeight(sharedHeight);
      const target = sharedHeight - HEADER_HEIGHT - BORDER_V;
      const rows = Math.max(3, Math.round(target / 48));
      setRowHeight(target / rows);
    }
  }, [sharedHeight]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const updateDimensions = () => {
      if (!wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const bottomReserve = 58;
      const available = Math.max(380, window.innerHeight - rect.top - bottomReserve);
      const targetContent = available - HEADER_HEIGHT - BORDER_V;
      const wholeRows = Math.max(3, Math.round(targetContent / 48));
      const dynamicRowHeight = targetContent / wholeRows;
      setRowHeight(dynamicRowHeight);
      setTableHeight(available);
    };

    updateDimensions();
    const raf1 = requestAnimationFrame(updateDimensions);
    const timer = setTimeout(updateDimensions, 150);

    const parent = el.parentElement;
    let ro: ResizeObserver | null = null;
    if (parent && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        updateDimensions();
      });
      ro.observe(parent);
    }

    window.addEventListener('resize', updateDimensions);
    return () => {
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [results]);

  return (
    <div
      ref={wrapRef}
      className="table-wrap"
      hidden={results.length === 0}
      style={tableHeight ? {
        height: `${tableHeight}px`,
        maxHeight: `${tableHeight}px`,
        ['--row-height' as string]: `${rowHeight}px`
      } : undefined}
    >
      <table>
        <thead>
          <tr>
            <th className="title-cell">Раздача</th>
            <th>Качество</th>
            <th>Сиды</th>
            <th>Размер</th>
            <th>Опубликовано</th>
            <th>Источник</th>
            <th aria-label="Действия" />
          </tr>
        </thead>
        <tbody>
          {results.map((item) => (
            <ResultRow
              key={item.id}
              item={item}
              activeYear={activeYear}
              onToast={onToast}
              onOpenMagnet={onOpenMagnet}
              onTitleMouseEnter={(e) => onTitleMouseEnter(item, e)}
              onTitleMouseLeave={onTitleMouseLeave}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({
  item,
  activeYear,
  onToast,
  onOpenMagnet,
  onTitleMouseEnter,
  onTitleMouseLeave
}: {
  item: TorrentResult;
  activeYear?: number;
  onToast(value: string): void;
  onOpenMagnet(item: TorrentResult): void;
  onTitleMouseEnter(e: React.MouseEvent): void;
  onTitleMouseLeave(): void;
}) {
  const doAction = async (action: Promise<{ ok: boolean; error?: string }>, success: string) => {
    const result = await action;
    onToast(result.ok ? success : result.error || 'Действие не удалось выполнить');
  };

  const handleCopyMagnet = async () => {
    let magnet = item.magnetUrl;
    if (!magnet && item.pageUrl) {
      onToast('Получение magnet-ссылки…');
      const res = await window.torrentApi.resolveMagnet(item.pageUrl);
      if (res.ok && res.magnet) {
        magnet = res.magnet;
        item.magnetUrl = res.magnet;
      } else {
        onToast(res.error || 'Не удалось найти magnet-ссылку на странице');
        return;
      }
    }
    if (magnet) {
      await doAction(window.torrentApi.copyMagnet(magnet), 'Magnet-ссылка скопирована.');
    } else {
      onToast('Magnet-ссылка недоступна для этой раздачи.');
    }
  };

  return (
    <tr>
      <td
        className="title-cell"
        onMouseEnter={onTitleMouseEnter}
        onMouseLeave={onTitleMouseLeave}
      >
        <strong>
          <a
            href={item.pageUrl}
            className="title-link"
            onClick={(e) => {
              e.preventDefault();
              void doAction(window.torrentApi.openExternal(item.pageUrl), 'Страница раздачи открыта в браузере.');
            }}
          >
            {item.title}
          </a>
        </strong>
        <span className="subline">
          {formatReleaseSubline(item, activeYear)}
        </span>
      </td>
      <td>
        <span className="quality">{resolutionLabels[item.resolution]}</span>
        <span className="subline">{rangeLabels[item.dynamicRange]}</span>
      </td>
      <td><span className="seed">{item.seeds ?? '—'}</span></td>
      <td>{item.sizeLabel}</td>
      <td>{formatDate(item.publishedAt)}</td>
      <td><span className="provider">{item.providerName}</span></td>
      <td>
        <div className="actions">
          <button
            type="button"
            title="Открыть страницу раздачи"
            onClick={() => void doAction(window.torrentApi.openExternal(item.pageUrl), 'Страница раздачи открыта в браузере.')}
          >
            ↗
          </button>
          {item.torrentUrl ? (
            <button
              type="button"
              title="Скачать .torrent"
              onClick={() => void doAction(window.torrentApi.downloadTorrent(item.torrentUrl!, item.title), 'Торрент-файл сохранён.')}
            >
              ⇩
            </button>
          ) : (
            <button type="button" disabled title="Прямая ссылка на торрент недоступна">⇩</button>
          )}
          <button
            type="button"
            title="Запустить раздачу (magnet)"
            onClick={() => void onOpenMagnet(item)}
          >
            ◉
          </button>
          <button
            type="button"
            title="Скопировать magnet-ссылку"
            onClick={() => void handleCopyMagnet()}
          >
            ⧉
          </button>
        </div>
      </td>
    </tr>
  );
}

function PosterTooltip({
  data
}: {
  data: { item: TorrentResult; x: number; y: number; url?: string; loading?: boolean } | null;
}) {
  if (!data) return null;

  const width = Math.min(460, window.innerWidth - 32);
  const totalHeight = 390;
  let left = data.x + 18;
  if (left + width > window.innerWidth - 16) {
    left = Math.max(16, data.x - width - 18);
  }
  let top = data.y - 40;
  if (top + totalHeight > window.innerHeight - 16) {
    top = Math.max(16, window.innerHeight - totalHeight - 16);
  }
  if (top < 16) top = 16;

  return (
    <div className="poster-tooltip-wrap" style={{ left: `${left}px`, top: `${top}px` }}>
      {/* Окошко с подробностями раздачи — располагается ВЫШЕ баннера */}
      <div className="poster-tooltip-details">
        <div className="poster-tooltip-details-text">
          {data.item.rawTitle}
        </div>
      </div>

      {/* Баннер с постером — располагается ПОД подробностями, не перекрывая их */}
      <div className="poster-tooltip-card">
        {data.url ? (
          <img
            src={data.url}
            alt={data.item.title}
            className="poster-tooltip-img"
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="poster-tooltip-placeholder">
            {data.loading ? 'Загрузка постера…' : 'Постер отсутствует'}
          </div>
        )}
        <div className="poster-tooltip-caption">
          <div className="poster-tooltip-title">{data.item.title}</div>
          <div className="poster-tooltip-sub">
            {formatReleaseSubline(data.item)}
          </div>
        </div>
      </div>
    </div>
  );
}

function MagnetActionModal({
  item,
  apps,
  onlyPlayers,
  onClose,
  onSelect
}: {
  item: TorrentResult;
  apps: DetectedApp[];
  onlyPlayers?: boolean;
  onClose: () => void;
  onSelect: (appId: string, remember: boolean) => Promise<void>;
}) {
  const [remember, setRemember] = useState(false);
  const clients = apps.filter((a) => a.type === 'client');
  const players = apps.filter((a) => a.type === 'player');
  const hasDedicatedClients = clients.length > 0;
  const hasDedicatedPlayers = players.length > 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="magnet-modal"
        role="dialog"
        aria-modal="true"
        aria-label={onlyPlayers ? 'Выбор плеера для просмотра' : 'Выбор приложения для раздачи'}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2>{onlyPlayers ? 'Выбор плеера для просмотра' : 'Открыть раздачу'}</h2>
            {onlyPlayers && (
              <div className="magnet-modal-subtitle">(можно изменить в настройках)</div>
            )}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="magnet-modal-body">
          <div className="magnet-release-info">
            <div className="magnet-release-title" title={item.rawTitle}>{item.title}</div>
            <div className="magnet-release-sub">
              {item.year ?? 'Год не указан'} · {resolutionLabels[item.resolution]} · {item.sizeLabel} · {item.providerName}
            </div>
          </div>

          {!onlyPlayers && (
            <div className="magnet-section">
              <div className="magnet-section-title">Скачать через торрент-клиент</div>
              {clients.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  className="magnet-app-btn"
                  onClick={() => void onSelect(app.id, remember)}
                >
                  <span className="magnet-app-icon">⇩</span>
                  <div className="magnet-app-info">
                    <div className="magnet-app-name">{app.name}</div>
                    <div className="magnet-app-desc">{app.description}</div>
                  </div>
                </button>
              ))}
              {!hasDedicatedClients && (
                <div className="magnet-not-found-box">
                  <div className="not-found-header">
                    <span className="not-found-icon">ℹ</span>
                    <strong>Подходящих торрент-клиентов на устройстве не обнаружено</strong>
                  </div>
                  <p className="not-found-text">
                    <b>Рекомендация:</b> Если хотите скачивать видео, рекомендуем установить бесплатный торрент-клиент <b>qBittorrent</b> или <b>uTorrent</b>!
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="magnet-section">
            <div className="magnet-section-title">
              {onlyPlayers ? 'Установленные видеоплееры' : 'Смотреть онлайн (без скачивания)'}
            </div>
            {hasDedicatedPlayers ? (
              players.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  className="magnet-app-btn"
                  onClick={() => void onSelect(app.id, remember)}
                >
                  <span className="magnet-app-icon">▶</span>
                  <div className="magnet-app-info">
                    <div className="magnet-app-name">{app.name}</div>
                    <div className="magnet-app-desc">{app.description}</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="magnet-not-found-box">
                <div className="not-found-header">
                  <span className="not-found-icon">ℹ</span>
                  <strong>Подходящих видеоплееров не обнаружено</strong>
                </div>
                <p className="not-found-text">
                  <b>Рекомендация:</b> Для онлайн-просмотра торрентов установите <b>TorrServer</b>, <b>VLC Player</b> или <b>PotPlayer</b>!
                </p>
                <button
                  type="button"
                  className="magnet-app-btn"
                  style={{ marginTop: '10px' }}
                  onClick={() => void onSelect('client:default', remember)}
                >
                  <span className="magnet-app-icon">↗</span>
                  <div className="magnet-app-info">
                    <div className="magnet-app-name">Открыть в плеере по умолчанию системы</div>
                    <div className="magnet-app-desc">Попытаться открыть ссылку через системный плеер</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
        <footer>
          <label className="magnet-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <div className="magnet-remember-text">
              <span>
                {onlyPlayers
                  ? 'Запомнить этот плеер для быстрого старта'
                  : 'Запомнить выбор (не спрашивать больше)'}
              </span>
              {onlyPlayers && (
                <span className="magnet-remember-hint">(можно изменить в настройках)</span>
              )}
            </div>
          </label>
          <button className="secondary" type="button" onClick={onClose}>Отмена</button>
        </footer>
      </section>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  isInitial,
  suggestedQuery,
  onApplySuggestion
}: {
  icon: string | React.ReactNode;
  title: string;
  description?: string;
  isInitial?: boolean;
  suggestedQuery?: string | null;
  onApplySuggestion?: (q: string) => void;
}) {
  return (
    <div className={`empty ${isInitial ? 'empty-initial' : ''}`}>
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {suggestedQuery && (
        <div style={{ marginTop: '16px', fontSize: '15px', color: '#cbd5e1' }}>
          Возможно, вы имели в виду:{' '}
          <button
            type="button"
            onClick={() => onApplySuggestion?.(suggestedQuery)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#38bdf8',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontWeight: 650,
              fontSize: '15.5px'
            }}
          >
            {suggestedQuery}
          </button>
          ?
        </div>
      )}
    </div>
  );
}

function SettingsDialog({
  settings,
  states,
  detectedApps,
  checking,
  onCheckProviders,
  onClose,
  onSave,
  onSettingsUpdated,
  onToast
}: {
  settings: AppSettings;
  states: ProviderState[];
  detectedApps: DetectedApp[];
  checking: boolean;
  onCheckProviders(): Promise<ProviderState[] | undefined>;
  onClose(): void;
  onSave(settings: AppSettings, showToast?: boolean): Promise<void>;
  onSettingsUpdated(settings: AppSettings): void;
  onToast(value: string): void;
}) {
  const [draft, setDraft] = useState(settings);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [gatewayTestResults, setGatewayTestResults] = useState<{
    worker?: { ok: boolean; status?: number; error?: string };
    backup?: { ok: boolean; status?: number; error?: string };
  } | null>(null);
  const [testingGateways, setTestingGateways] = useState(false);

  const handleTestGateways = async () => {
    if (!window.torrentApi.testGateways) return;
    setTestingGateways(true);
    try {
      const res = await window.torrentApi.testGateways();
      setGatewayTestResults(res);
      if (res.worker?.ok && res.backup?.ok) {
        onToast('Оба шлюза успешно ответили!');
      } else if (res.worker?.ok) {
        onToast('Основной шлюз (Cloudflare) доступен.');
      } else {
        onToast('Проверка шлюзов завершена с ошибками.');
      }
    } catch {
      onToast('Ошибка при выполнении проверки шлюзов.');
    } finally {
      setTestingGateways(false);
    }
  };

  const testProviders = async () => {
    await onSave({
      ...draft,
      customStudios: draft.customStudios || [],
      qualityAliases: draft.qualityAliases || []
    }, false);
    await onCheckProviders();
  };

  const refreshAuth = async () => {
    const updated = await window.torrentApi.getSettings();
    setDraft(updated);
    onSettingsUpdated(updated);
    await onCheckProviders();
  };

  const save = async () => {
    await onSave({
      ...draft,
      customStudios: draft.customStudios || [],
      qualityAliases: draft.qualityAliases || []
    }, true);
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки">
        <header>
          <h2>Настройки</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <div className="setting-block">
          <div className="setting-head">
            <h3>Трекеры</h3>
            <button
              className="primary"
              type="button"
              onClick={() => void testProviders()}
              disabled={checking}
              style={{ width: '175px', minWidth: '175px', textAlign: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {checking ? 'Проверяем…' : 'Проверить трекеры'}
            </button>
          </div>
          {draft.providers.map((provider) => {
            const state = states.find((item) => item.id === provider.id);
            const isRuTracker = provider.id === 'rutracker';
            const isAuth = isRuTracker && Boolean(draft.rutrackerAuth?.authorized);

            let statusText = 'Не проверен';
            let statusColor = '';

            if (state?.status === 'ok') {
              statusText = 'Доступен';
              statusColor = 'green';
            } else if (state?.status === 'error') {
              statusText = state.message ? `Недоступен: ${state.message}` : 'Недоступен';
              statusColor = 'red';
            } else if (isRuTracker) {
              statusText = isAuth ? `Авторизован (${draft.rutrackerAuth?.username || 'OK'})` : 'Требуется авторизация';
              statusColor = isAuth ? 'green' : '';
            } else if (provider.note) {
              statusText = provider.note;
            }

            return (
              <div className="provider-setting-row" key={provider.id}>
                <label className="provider-setting">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        providers: draft.providers.map((item) =>
                          item.id === provider.id ? { ...item, enabled: event.target.checked } : item
                        )
                      })
                    }
                  />
                  <span>{provider.name}</span>
                  <small className={statusColor}>{statusText}</small>
                </label>
                {isRuTracker && (
                  <button
                    className={isAuth ? 'auth-btn active' : 'auth-btn'}
                    type="button"
                    onClick={() => setAuthModalOpen(true)}
                    title="Настроить авторизацию RuTracker"
                  >
                    {isAuth ? 'Сессия RuTracker ⚙' : 'Войти в RuTracker 🔑'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="setting-block">
          <div className="setting-head">
            <h3>Обход блокировок трекеров в РФ</h3>
            <button
              className="primary"
              type="button"
              onClick={() => void handleTestGateways()}
              disabled={testingGateways || !draft.bypassBlocking}
              style={{ width: '175px', minWidth: '175px', textAlign: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {testingGateways ? 'Проверяем…' : 'Проверить шлюзы'}
            </button>
          </div>
          <p className="setting-description">
            Использование прокси-шлюзов для доступа к трекерам
          </p>

          <div style={{ display: 'flex', gap: '14px', marginTop: '16px', marginBottom: '14px' }}>
            <button
              type="button"
              className={draft.bypassBlocking ? 'primary' : 'secondary'}
              style={{
                width: '165px',
                padding: '10px 18px',
                fontSize: '13.5px',
                fontWeight: draft.bypassBlocking ? 650 : 500,
                textAlign: 'center',
                borderRadius: '8px',
                border: draft.bypassBlocking ? '1px solid #3b82f6' : '1px solid #334155'
              }}
              onClick={async () => {
                const updated = { ...draft, bypassBlocking: true };
                setDraft(updated);
                await onSave({
                  ...updated,
                  customStudios: updated.customStudios || [],
                  qualityAliases: updated.qualityAliases || []
                }, false);
              }}
            >
              Включить обход
            </button>
            <button
              type="button"
              className={!draft.bypassBlocking ? 'primary' : 'secondary'}
              style={{
                width: '165px',
                padding: '10px 18px',
                fontSize: '13.5px',
                fontWeight: !draft.bypassBlocking ? 650 : 500,
                textAlign: 'center',
                borderRadius: '8px',
                border: !draft.bypassBlocking ? '1px solid #3b82f6' : '1px solid #334155'
              }}
              onClick={async () => {
                const updated = { ...draft, bypassBlocking: false };
                setDraft(updated);
                await onSave({
                  ...updated,
                  customStudios: updated.customStudios || [],
                  qualityAliases: updated.qualityAliases || []
                }, false);
              }}
            >
              Выключить обход
            </button>
          </div>

          {draft.bypassBlocking && gatewayTestResults && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 14px', background: '#0b0f17', border: '1px solid #1e293b', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                <span style={{ color: '#cbd5e1' }}>🥇 Основной шлюз (Cloudflare):</span>
                <span style={{ fontWeight: 650, color: gatewayTestResults.worker?.ok ? '#22c55e' : '#ef4444' }}>
                  {gatewayTestResults.worker?.ok ? '✓ Доступен' : `✗ ${gatewayTestResults.worker?.error || 'Недоступен'}`}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                <span style={{ color: '#cbd5e1' }}>🥈 Резервный шлюз (Supabase):</span>
                <span style={{ fontWeight: 650, color: gatewayTestResults.backup?.ok ? '#22c55e' : '#ef4444' }}>
                  {gatewayTestResults.backup?.ok ? '✓ Доступен' : `✗ ${gatewayTestResults.backup?.error || 'Недоступен'}`}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="setting-block">
          <div className="setting-head">
            <h3>Действие для магнет-ссылок</h3>
          </div>
          <p className="setting-description">
            Выберите, какое приложение запускать при клике на магнет-ссылку!
          </p>
          <div className="select-row">
            <select
              value={draft.magnetAction || 'ask'}
              onChange={(e) => setDraft({ ...draft, magnetAction: e.target.value })}
              className="settings-select"
            >
              <option value="ask">Спрашивать каждый раз (окно выбора)</option>
              {detectedApps.some((a) => a.type === 'client') && (
                <optgroup label="Клиенты для скачивания">
                  {detectedApps
                    .filter((a) => a.type === 'client')
                    .map((app) => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                </optgroup>
              )}
              {detectedApps.some((a) => a.type === 'player') && (
                <optgroup label="Онлайн-просмотр (без скачивания)">
                  {detectedApps
                    .filter((a) => a.type === 'player')
                    .map((app) => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                </optgroup>
              )}
            </select>
          </div>
          {!detectedApps.some((a) => a.type === 'player') && (
            <p className="hint" style={{ marginTop: '8px' }}>
              💡 <b>Онлайн-просмотр:</b> на ПК не найден сервер TorrServer или совместимый плеер. Если хотите смотреть видео онлайн без скачивания, установите <b>TorrServer</b> и медиаплеер <b>VLC</b> или <b>MPC-HC (K-Lite Codec Pack)</b>!
            </p>
          )}
          {!detectedApps.some((a) => a.type === 'client') && (
            <p className="hint" style={{ marginTop: '6px' }}>
              💡 <b>Скачивание торрентов:</b> на ПК не найден подходящий торрент-клиент. Для удобной загрузки рекомендуем установить бесплатный торрент-клиент <b>qBittorrent</b> или <b>uTorrent</b>!
            </p>
          )}
        </div>

        <div className="setting-block">
          <div className="setting-head">
            <h3>Плеер для быстрого старта просмотра</h3>
          </div>
          <p className="setting-description">
            Видеоплеер для быстрого воспроизведения по кнопке на постере раздачи
          </p>
          <div className="select-row">
            <select
              value={draft.quickPlayerApp || 'ask'}
              onChange={(e) => setDraft({ ...draft, quickPlayerApp: e.target.value })}
              className="settings-select"
            >
              <option value="ask">Всегда спрашивать (окно выбора плеера)</option>
              {detectedApps
                .filter((a) => a.type === 'player')
                .map((app) => (
                  <option key={app.id} value={app.id}>{app.name}</option>
                ))}
            </select>
          </div>
        </div>

        <footer>
          <div />
          <div>
            <button className="secondary" type="button" onClick={onClose}>Отмена</button>
            <button className="primary" type="button" onClick={() => void save()}>Сохранить</button>
          </div>
        </footer>
      </section>
      {authModalOpen && (
        <RuTrackerAuthModal
          auth={draft.rutrackerAuth}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={refreshAuth}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function RuTrackerAuthModal({ auth, onClose, onSuccess, onToast }: { auth?: AppSettings['rutrackerAuth']; onClose: () => void; onSuccess: () => Promise<void>; onToast: (msg: string) => void }) {
  const [cookie, setCookie] = useState(auth?.cookie || '');
  const [username, setUsername] = useState(auth?.username || '');
  const [loading, setLoading] = useState(false);
  const [showCookie, setShowCookie] = useState(false);

  const handleBrowserLogin = async () => {
    setLoading(true);
    try {
      const res = await window.torrentApi.openRuTrackerLogin();
      if (res.ok) {
        onToast(`Успешный вход в RuTracker${res.username ? ` (${res.username})` : ''}!`);
        await onSuccess();
        onClose();
      } else if (res.error) {
        onToast(res.error);
        await onSuccess();
      }
    } catch {
      onToast('Ошибка при открытии окна авторизации.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSystemBrowser = async () => {
    try {
      await window.torrentApi.openExternal('https://rutracker.org/forum/index.php');
      onToast('RuTracker открыт в вашем обычном браузере.');
    } catch {
      onToast('Не удалось открыть браузер.');
    }
  };

  const handlePasteClipboard = async () => {
    try {
      let text = '';
      if (window.torrentApi.readClipboard) {
        text = await window.torrentApi.readClipboard();
      } else {
        text = await navigator.clipboard.readText();
      }
      text = text.trim();
      if (!text) {
        onToast('Буфер обмена пуст.');
        return;
      }
      setCookie(text);
      onToast('✓ Данные из буфера обмена вставлены.');
    } catch {
      onToast('Не удалось прочитать буфер обмена.');
    }
  };

  const handleSaveCookie = async () => {
    if (!cookie.trim()) {
      onToast('Введите Cookie для сохранения.');
      return;
    }
    setLoading(true);
    try {
      const res = await window.torrentApi.saveRuTrackerAuth({ cookie, username });
      if (res.ok) {
        onToast(`Данные авторизации RuTracker сохранены!${res.username ? ` (${res.username})` : ''}`);
        await onSuccess();
        onClose();
      } else {
        onToast(res.error || 'Не удалось сохранить авторизацию');
      }
    } catch {
      onToast('Ошибка сохранения данных авторизации.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await window.torrentApi.clearRuTrackerAuth();
      setCookie('');
      setUsername('');
      onToast('Вы вышли из RuTracker.');
      await onSuccess();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop submodal" role="presentation">
      <section className="settings-modal auth-modal" role="dialog" aria-modal="true" aria-label="Авторизация RuTracker">
        <header>
          <div>
            <h2>Авторизация в RuTracker</h2>
            <p>Поиск по раздачам RuTracker требует учётную запись.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <div className="setting-block">
          <div className="auth-status-card">
            <span>Текущий статус:</span>
            {auth?.authorized ? (
              <strong className="green">✓ Авторизован {auth.username ? `(${auth.username})` : ''}</strong>
            ) : (
              <strong className="red">✗ Не авторизован</strong>
            )}
          </div>
        </div>

        <div className="setting-block">
          <h3>Способ 1: Вход через окно программы</h3>
          <p className="hint">
            Откроется официальная страница входа RuTracker. Проверка безопасности («Один момент...») проходит автоматически за 1–2 секунды без блокировок. Введите ваш логин и пароль RuTracker и нажмите кнопку «Вход». Окно автоматически закроется, и авторизация сохранится.
          </p>
          <button className="primary auth-action-btn" type="button" onClick={() => void handleBrowserLogin()} disabled={loading}>
            {loading ? 'Ожидание входа…' : '🔑 Открыть окно авторизации'}
          </button>
        </div>

        <div className="setting-block">
          <h3>Способ 2: Вход через ваш обычный браузер и Cookie (100% надёжно)</h3>
          <p className="hint">
            Войдите на RuTracker в вашем обычном браузере (Chrome / Edge / Яндекс / Opera) под своим логином и паролем, затем вставьте Cookie сюда:
          </p>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px', marginBottom: '10px' }}>
            <button className="secondary" type="button" onClick={() => void handleOpenSystemBrowser()} style={{ flex: 1, padding: '8px 12px', fontSize: '12.5px' }}>
              🌐 Открыть RuTracker в браузере
            </button>
            <button className="secondary" type="button" onClick={() => void handlePasteClipboard()} style={{ flex: 1, padding: '8px 12px', fontSize: '12.5px' }}>
              📋 Вставить из буфера обмена
            </button>
          </div>
          <div className="form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <label style={{ margin: 0 }}>Строка Cookie (bb_data, bb_session или вся скопированная таблица):</label>
              <button
                type="button"
                className="text-button"
                onClick={() => setShowCookie((prev) => !prev)}
                style={{ padding: '2px 8px', fontSize: '12px', color: '#60a5fa', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                title={showCookie ? 'Замаскировать строку Cookie' : 'Показать значение Cookie'}
              >
                {showCookie ? '👁️ Скрыть Cookie' : '👁️‍🗨️ Показать Cookie'}
              </button>
            </div>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="Вставьте сюда bb_data, bb_session или просто скопируйте всю таблицу из вкладки Cookies (Ctrl+A -> Ctrl+C)"
              rows={3}
              className={showCookie ? '' : 'masked-cookie'}
            />
          </div>
          <div className="form-field">
            <label>Имя пользователя (необязательно):</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Ваш логин на RuTracker"
            />
          </div>
          <div className="auth-btn-row">
            <button className="primary" type="button" onClick={() => void handleSaveCookie()} disabled={loading || !cookie.trim()}>
              💾 Сохранить Cookie
            </button>
            {auth?.authorized && (
              <button className="text-button danger" type="button" onClick={() => void handleLogout()} disabled={loading}>
                Выйти из аккаунта
              </button>
            )}
          </div>

          <details style={{ marginTop: '14px', background: '#141414', padding: '10px 12px', borderRadius: '6px', border: '1px solid #333333', fontSize: '12px', color: '#a3a3a3' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#ffffff' }}>
              💡 Инструкция: как скопировать Cookie из браузера за 10 секунд
            </summary>
            <div style={{ paddingLeft: '4px', marginTop: '8px', lineHeight: '1.6' }}>
              <ol style={{ paddingLeft: '18px' }}>
                <li>В вашем обычном браузере (Chrome / Edge / Яндекс) откройте <b>RuTracker</b>, где вы авторизованы.</li>
                <li>Нажмите клавишу <b>F12</b> → перейдите во вкладку <b>«Приложение» (Application)</b> или <b>«Хранилище» (Storage)</b>.</li>
                <li>Слева в меню раскройте раздел <b>«Файлы cookie» (Cookies)</b> → выберите <b>rutracker.org</b> (или зеркало, если используете: <i>rutracker.net</i>, <i>rutracker.nl</i>).</li>
                <li>Кликните по любой строке в таблице справа, нажмите <b>Ctrl+A</b> (выделить всё) и <b>Ctrl+C</b> (скопировать). Либо просто скопируйте значение строки <code>bb_session</code> или <code>bb_data</code>.</li>
                <li>Вернитесь сюда и нажмите <b>«Вставить из буфера обмена»</b> → <b>«Сохранить Cookie»</b>.</li>
              </ol>
            </div>
          </details>
        </div>

        <footer>
          <div />
          <button className="secondary" type="button" onClick={onClose}>Закрыть</button>
        </footer>
      </section>
    </div>
  );
}

function uniqueNumbers(values: Array<number | undefined>): number[] { return [...new Set(values.filter((value): value is number => value !== undefined))].sort((a, b) => a - b); }
function formatDate(value?: string): string { if (!value) return 'Не указано'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Не указано' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date); }

function getPageList(current: number, total: number): Array<number | '...'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  if (current <= 3) return [0, 1, 2, 3, 4, '...', total - 1];
  if (current >= total - 4) return [0, '...', total - 5, total - 4, total - 3, total - 2, total - 1];
  return [0, '...', current - 1, current, current + 1, '...', total - 1];
}

function AppLogo({ size = 34 }: { size?: number }) {
  return (
    <img
      src="./icon.png"
      alt="Поисковик торрентов"
      width={size}
      height={size}
      style={{ display: 'block', borderRadius: '8px', objectFit: 'contain' }}
      draggable={false}
    />
  );
}

function VoiceSearchModal({
  isRecording,
  isTranscribing,
  audioLevel,
  onCancel
}: {
  isRecording: boolean;
  isTranscribing: boolean;
  audioLevel: number;
  onCancel: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="voice-modal-backdrop" onClick={onCancel} role="presentation">
      <div className="voice-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Голосовой поиск">
        <button type="button" className="voice-modal-close" onClick={onCancel} aria-label="Закрыть">×</button>

        <div className="voice-orb-wrapper">
          <div
            className={`voice-orb-glow ${isRecording ? 'active' : ''}`}
            style={{
              transform: isRecording ? `scale(${1 + Math.min(audioLevel * 4, 0.45)})` : 'scale(1)'
            }}
          />
          <div className={`voice-orb ${isRecording ? 'recording' : ''} ${isTranscribing ? 'transcribing' : ''}`}>
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="voice-orb-icon"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </div>
        </div>

        <h3 className="voice-modal-title">
          {isTranscribing ? 'Распознавание речи…' : 'Слушаю…'}
        </h3>
        <p className="voice-modal-subtitle">
          {isTranscribing ? 'Умная обработка и автоисправление названия' : 'Назовите фильм, сериал или телешоу!'}
        </p>

        {isRecording && (
          <div className="voice-wave-bars">
            <span className="wave-bar bar-1" style={{ height: `${Math.max(8, Math.min(38, 12 + audioLevel * 140))}px` }} />
            <span className="wave-bar bar-2" style={{ height: `${Math.max(12, Math.min(50, 16 + audioLevel * 200))}px` }} />
            <span className="wave-bar bar-3" style={{ height: `${Math.max(14, Math.min(46, 18 + audioLevel * 180))}px` }} />
            <span className="wave-bar bar-4" style={{ height: `${Math.max(8, Math.min(34, 12 + audioLevel * 120))}px` }} />
          </div>
        )}

        <button type="button" className="voice-modal-cancel-btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
