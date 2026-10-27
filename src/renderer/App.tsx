import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, ContentType, DetectedApp, DynamicRange, FilterState, ProviderState, Resolution, SortState, TorrentResult } from '../shared/types';
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
const rangeLabels: Record<DynamicRange, string> = { sdr: 'SDR', hdr: 'HDR', hdr10: 'HDR10', hdr10plus: 'HDR10+', 'dolby-vision': 'Dolby Vision', unknown: 'Не указано' };
const contentLabels: Record<ContentType, string> = { all: 'Всё', movie: 'Фильм', series: 'Сериал', reality: 'Реалити-шоу' };
const initialSort: SortState = { field: 'relevance', direction: 'desc' };
const PAGE_SIZE = 50;

function formatReleaseSubline(item: { contentType: ContentType; year?: number; season?: number; part?: number }): string {
  let typeWord = 'Фильм';
  if (item.contentType === 'series') typeWord = 'Сериал';
  else if (item.contentType === 'reality') typeWord = 'Телешоу';

  let text = item.year ? `${typeWord} ${item.year} года` : typeWord;

  if (item.season && (item.contentType === 'series' || item.contentType === 'reality')) {
    text += ` · Сезон ${item.season}`;
  }

  if (item.part) {
    text += ` · Часть ${item.part}`;
  }

  return text;
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
  const [hasMoreRemote, setHasMoreRemote] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const remotePage = useRef(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const [providerCheckStates, setProviderCheckStates] = useState<ProviderState[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const resolvedTopicUrls = useRef<Set<string>>(new Set());
  const [detectedApps, setDetectedApps] = useState<DetectedApp[]>([]);
  const [magnetModal, setMagnetModal] = useState<{ item: TorrentResult; magnet: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const currentHoveredId = useRef<string | null>(null);
  const [hoverPoster, setHoverPoster] = useState<{
    item: TorrentResult;
    x: number;
    y: number;
    url: string;
  } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (payload.batch.length > 0) {
        setResults((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          const newItems = payload.batch.filter((i) => !existingIds.has(i.id));
          return newItems.length ? [...prev, ...newItems] : prev;
        });
      }
      setStates((prev) => {
        const without = prev.filter((s) => s.id !== payload.providerState.id);
        return [...without, payload.providerState];
      });
    });

    return () => {
      if (requestId.current) void window.torrentApi.cancelSearch(requestId.current);
      unsubStream?.();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!historyOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHistoryOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [historyOpen]);

  useEffect(() => {
    setPage(0);
  }, [filters, sort]);

  const visible = useMemo(() => sortResults(filterResults(results, filters), sort), [results, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, Math.max(0, totalPages - 1));
  const pagedResults = useMemo(() => {
    const start = currentPage * PAGE_SIZE;
    return visible.slice(start, start + PAGE_SIZE);
  }, [visible, currentPage]);

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

  const relevantResultsForSeasons = useMemo(() => {
    return results.filter((item) => {
      if (filters.years?.length && (item.year === undefined || !filters.years.includes(item.year))) return false;
      if (filters.providers?.length && !filters.providers.includes(item.providerId)) return false;
      if (filters.resolutions.length && !filters.resolutions.includes(item.resolution)) return false;
      return true;
    });
  }, [results, filters.years, filters.providers, filters.resolutions]);

  const hasSeriesInActiveView = useMemo(() => {
    return relevantResultsForSeasons.some((item) => item.contentType === 'series' || item.contentType === 'reality');
  }, [relevantResultsForSeasons]);

  const seasonsList = useMemo(() => {
    if (!hasSeriesInActiveView) return [];
    return uniqueNumbers(
      relevantResultsForSeasons
        .filter((item) => item.contentType === 'series' || item.contentType === 'reality')
        .map((item) => item.season)
    );
  }, [hasSeriesInActiveView, relevantResultsForSeasons]);

  useEffect(() => {
    if (!hasSeriesInActiveView && (filters.seasons?.length ?? 0) > 0) {
      updateFilter('seasons', []);
    }
  }, [hasSeriesInActiveView, filters.seasons]);

  const facets = useMemo(() => ({
    seasons: seasonsList,
    parts: uniqueNumbers(results.map((item) => item.part)),
    years: uniqueNumbers(results.map((item) => item.year)).sort((a, b) => b - a)
  }), [seasonsList, results]);

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
    remotePage.current = 0;
    setHasMoreRemote(false);
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
      setHasMoreRemote(Boolean(response.hasMore));
      setHistory(await window.torrentApi.getHistory());
    } catch {
      if (requestId.current === id) setToast('Не удалось выполнить поиск. Проверьте состояние источников.');
    } finally {
      if (requestId.current === id) { setSearching(false); requestId.current = null; }
    }
  };

  const loadMoreRemote = async () => {
    if (searching || loadingMore || !hasMoreRemote) return;
    setLoadingMore(true);
    const nextRemote = remotePage.current + 1;
    const id = crypto.randomUUID();
    try {
      const response = await window.torrentApi.search({ requestId: id, query, exact, contentType, page: nextRemote });
      if (response.cancelled) return;
      remotePage.current = nextRemote;
      setHasMoreRemote(Boolean(response.hasMore));
      setStates(response.providerStates);
      setResults((previous) => {
        const existingIds = new Set(previous.map((item) => item.id));
        const newItems = response.results.filter((item) => !existingIds.has(item.id) && (item.seeds ?? 0) >= 1);
        if (newItems.length === 0) {
          setToast('Больше новых раздач с источников не найдено.');
        } else {
          setToast(`Загружено ещё ${newItems.length} раздач с трекеров.`);
        }
        return [...previous, ...newItems];
      });
    } catch {
      setToast('Не удалось загрузить следующие страницы с источников.');
    } finally {
      setLoadingMore(false);
    }
  };

  const cancelSearch = async () => {
    if (requestId.current) await window.torrentApi.cancelSearch(requestId.current);
    requestId.current = null;
    setSearching(false);
    setLoadingMore(false);
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
    setHasMoreRemote(false);
    setToast('Результаты поиска удалены.');
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => setFilters((previous) => ({ ...previous, [key]: value }));
  const toggle = <T,>(items: T[], value: T): T[] => items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
  const clearFilter = (key: keyof FilterState) => {
    updateFilter(key, [] as never);
  };

  const saveSettings = async (next: AppSettings) => {
    const saved = await window.torrentApi.saveSettings(next);
    setSettings(saved);
    setToast('Настройки сохранены.');
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

  const handleChooseMagnetApp = async (appId: string, remember: boolean) => {
    if (!magnetModal) return;
    const { magnet, item } = magnetModal;
    setMagnetModal(null);
    const res = await window.torrentApi.openMagnetWith(magnet, appId, item.title, remember);
    if (remember && settings) {
      setSettings({ ...settings, magnetAction: appId });
    }
    setToast(res.ok ? 'Раздача запущена в выбранном приложении.' : (res.error || 'Ошибка запуска приложения'));
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
      const url = await window.torrentApi.resolvePoster(item.title, item.year, item.pageUrl, item.contentType);
      if (!url || currentHoveredId.current !== item.id) return;

      const img = new Image();
      img.src = url;
      img.onload = () => {
        if (currentHoveredId.current === item.id) {
          setHoverPoster({
            item,
            x: clientX,
            y: clientY,
            url
          });
        }
      };
    }, 200);
  };

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
        <span className="brand-mark">
          <AppLogo size={24} />
        </span>
        <span>Поисковик торрентов</span>
      </div>
      <div className="search-input-wrap" ref={searchWrapRef}>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            setHistoryOpen(false);
            void runSearch();
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => { if (history.length > 0) setHistoryOpen(true); }}
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
      <button className="icon-button" type="button" onClick={() => void openSettings()} title="Настройки" aria-label="Настройки">⚙</button>
    </header>

    <section className="query-controls" aria-label="Режим поиска">
      <div className="segmented" role="group" aria-label="Режим поиска">
        <button className={!exact ? 'selected' : ''} onClick={() => setExact(false)} type="button">Обычный</button>
        <button className={exact ? 'selected' : ''} onClick={() => setExact(true)} type="button">Точный</button>
      </div>
      {searching && <button className="text-button danger" onClick={() => void cancelSearch()} type="button">Отменить поиск</button>}
      <StatusSummary providerStates={providerCheckStates} searching={searching} checking={checkingProviders} />
    </section>

    <div className="sticky-controls">
      <section className="filter-panel">
        <div className="filter-groups-left">
          <FilterGroup title="Разрешение видео" values={(['480p', '720p', '1080p', '2160p'] as Resolution[])} labels={resolutionLabels} active={filters.resolutions} onToggle={(value) => updateFilter('resolutions', filters.resolutions.includes(value) ? [] : [value])} />
          <FilterGroup title="Динамический диапазон" values={(['sdr', 'hdr', 'dolby-vision'] as DynamicRange[])} labels={rangeLabels} active={filters.dynamicRanges} onToggle={(value) => updateFilter('dynamicRanges', filters.dynamicRanges.includes(value) ? [] : [value])} />
          {availableProviders.length > 1 && (
            <FilterGroup
              title="Источник"
              values={availableProviders.map((p) => p.id)}
              labels={providerLabels}
              active={filters.providers ?? []}
              onToggle={(value) => updateFilter('providers', (filters.providers ?? []).includes(value) ? [] : [value])}
            />
          )}
          {facets.years.length > 0 && (
            <YearDropdown
              years={facets.years}
              activeYear={filters.years?.[0]}
              onSelect={(year) => updateFilter('years', year ? [year] : [])}
            />
          )}
          {facets.seasons.length > 0 && <FilterGroup title="Сезон" values={facets.seasons} labels={Object.fromEntries(facets.seasons.map((season) => [season, `S${season}`]))} active={filters.seasons} onToggle={(value) => updateFilter('seasons', toggle(filters.seasons, value))} />}
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
        <div>
          <strong>{visible.length}</strong> из {results.length} раздач
          {totalPages > 1 && ` (страница ${currentPage + 1} из ${totalPages}, показаны ${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, visible.length)})`}
          {searched && results.length === 0 ? ' — ничего не найдено' : ''}
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
      </section>

      <ActiveFilters filters={filters} providerLabels={providerLabels} onClear={clearFilter} onReset={() => setFilters(emptyFilters())} />
    </div>
    <ResultsTable
      results={pagedResults}
      onToast={setToast}
      onOpenMagnet={handleOpenMagnet}
      onTitleMouseEnter={handleTitleMouseEnter}
      onTitleMouseLeave={handleTitleMouseLeave}
    />
    {searched && !searching && hasMoreRemote && results.length > 0 && (
      <div className="load-more-wrap">
        <button type="button" className="load-more-btn" onClick={() => void loadMoreRemote()} disabled={loadingMore}>
          {loadingMore ? 'Загрузка дополнительных раздач…' : 'Загрузить больше результатов'}
        </button>
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
    {searched && !searching && results.length === 0 && <EmptyState icon="◌" title="Раздачи не найдены" description="Источники могли быть недоступны или не содержать русскоязычных метаданных. Проверьте их в настройках." />}
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
        onClose={() => setMagnetModal(null)}
        onSelect={handleChooseMagnetApp}
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
  if (checking && !providerStates.length) {
    return <span className="status checking"><i />Проверка доступности источников…</span>;
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
    ['resolutions', filters.resolutions.join(', ')],
    ['dynamicRanges', filters.dynamicRanges.map((range) => rangeLabels[range]).join(', ')],
    ['providers', (filters.providers ?? []).map((p) => providerLabels[p] || p).join(', ')],
    ['years', (filters.years ?? []).map((y) => String(y)).join(', ')],
    ['seasons', filters.seasons.map((season) => `S${season}`).join(', ')],
    ['parts', filters.parts.map((part) => `Часть ${part}`).join(', ')]
  ].filter(([, label]) => label) as Array<[keyof FilterState, string]>;
  if (!current.length) return null;
  return <div className="active-filters"><span>Активные фильтры:</span>{current.map(([key, label]) => <button type="button" key={key} onClick={() => onClear(key)}>{label} <b>×</b></button>)}<button className="reset" type="button" onClick={onReset}>Сбросить все</button></div>;
}

function ResultsTable({
  results,
  onToast,
  onOpenMagnet,
  onTitleMouseEnter,
  onTitleMouseLeave
}: {
  results: TorrentResult[];
  onToast(value: string): void;
  onOpenMagnet(item: TorrentResult): void;
  onTitleMouseEnter(item: TorrentResult, e: React.MouseEvent): void;
  onTitleMouseLeave(): void;
}) {
  return (
    <div className="table-wrap" hidden={results.length === 0}>
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
  onToast,
  onOpenMagnet,
  onTitleMouseEnter,
  onTitleMouseLeave
}: {
  item: TorrentResult;
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
        <strong title={item.rawTitle}>
          <a
            href={item.pageUrl}
            className="title-link"
            title={`Открыть «${item.title}» на ${item.providerName}`}
            onClick={(e) => {
              e.preventDefault();
              void doAction(window.torrentApi.openExternal(item.pageUrl), 'Страница раздачи открыта в браузере.');
            }}
          >
            {item.title}
          </a>
        </strong>
        <span className="subline">
          {formatReleaseSubline(item)}
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
  data: { item: TorrentResult; x: number; y: number; url: string } | null;
}) {
  if (!data || !data.url) return null;

  const width = 200;
  const height = 330;
  let left = data.x + 18;
  if (left + width > window.innerWidth - 16) {
    left = Math.max(16, data.x - width - 18);
  }
  let top = data.y - 40;
  if (top + height > window.innerHeight - 16) {
    top = Math.max(16, window.innerHeight - height - 16);
  }
  if (top < 16) top = 16;

  return (
    <div className="poster-tooltip" style={{ left: `${left}px`, top: `${top}px` }}>
      <img
        src={data.url}
        alt={data.item.title}
        className="poster-tooltip-img"
        onError={(e) => {
          (e.currentTarget as HTMLElement).style.display = 'none';
        }}
      />
      <div className="poster-tooltip-caption">
        <div className="poster-tooltip-title">{data.item.title}</div>
        <div className="poster-tooltip-sub">
          {formatReleaseSubline(data.item)}
        </div>
      </div>
    </div>
  );
}

function MagnetActionModal({
  item,
  apps,
  onClose,
  onSelect
}: {
  item: TorrentResult;
  apps: DetectedApp[];
  onClose: () => void;
  onSelect: (appId: string, remember: boolean) => Promise<void>;
}) {
  const [remember, setRemember] = useState(false);
  const clients = apps.filter((a) => a.type === 'client');
  const players = apps.filter((a) => a.type === 'player');
  const hasDedicatedClients = clients.length > 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="magnet-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Выбор приложения для раздачи"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2>Открыть раздачу</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="magnet-modal-body">
          <div className="magnet-release-info">
            <div className="magnet-release-title" title={item.rawTitle}>{item.title}</div>
            <div className="magnet-release-sub">
              {item.year ?? 'Год не указан'} · {resolutionLabels[item.resolution]} · {item.sizeLabel} · {item.providerName}
            </div>
          </div>

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

          <div className="magnet-section">
            <div className="magnet-section-title">Смотреть онлайн (без скачивания)</div>
            {players.length > 0 ? (
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
                  <strong>Подходящих плееров для онлайн-просмотра на устройстве не обнаружено</strong>
                </div>
                <p className="not-found-text">
                  <b>Рекомендация:</b> Если хотите посмотреть видео онлайн без предварительного скачивания, установите сервер <b>TorrServer</b> и медиаплеер <b>VLC</b> или <b>MPC-HC (K-Lite Codec Pack)</b>!
                </p>
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
            <span>Запомнить выбор (не спрашивать больше)</span>
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
  isInitial
}: {
  icon: string | React.ReactNode;
  title: string;
  description?: string;
  isInitial?: boolean;
}) {
  return (
    <div className={`empty ${isInitial ? 'empty-initial' : ''}`}>
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
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
  onSave(settings: AppSettings): Promise<void>;
  onSettingsUpdated(settings: AppSettings): void;
  onToast(value: string): void;
}) {
  const [draft, setDraft] = useState(settings);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const testProviders = async () => {
    await onCheckProviders();
  };

  const refreshAuth = async () => {
    const updated = await window.torrentApi.getSettings();
    setDraft(updated);
    onSettingsUpdated(updated);
  };

  const save = async () => {
    await onSave({
      ...draft,
      customStudios: draft.customStudios || [],
      qualityAliases: draft.qualityAliases || []
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Настройки">
        <header>
          <div>
            <h2>Настройки</h2>
            <p>Управляйте публичными источниками и параметрами поиска.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>

        <div className="setting-block">
          <div className="setting-head">
            <h3>Источники</h3>
            <button className="secondary" type="button" onClick={() => void testProviders()} disabled={checking}>
              {checking ? 'Проверяем…' : 'Проверить доступность'}
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
            <h3>Действие для magnet-ссылок</h3>
          </div>
          <p className="setting-description">
            Выберите, какое приложение запускать при клике на магнет-ссылку: торрент-клиент для скачивания или плеер для онлайн-просмотра.
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
            <label>Строка Cookie (bb_data, bb_session или вся скопированная таблица):</label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder="Вставьте сюда bb_data, bb_session или просто скопируйте всю таблицу из вкладки Cookies (Ctrl+A -> Ctrl+C)"
              rows={3}
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

function AppLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} style={{ display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id="logoBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="logoBorder" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="50%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="logoLens" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#064e3b" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x="24" y="24" width="464" height="464" rx="108" fill="url(#logoBg)" stroke="url(#logoBorder)" strokeWidth="12" />
      <g transform="translate(48, 60) rotate(-6, 200, 180)">
        <rect x="50" y="80" width="280" height="200" rx="18" fill="#131d2e" stroke="#2563eb" strokeWidth="4" />
        <rect x="70" y="92" width="24" height="18" rx="4" fill="#38bdf8" opacity="0.9" />
        <rect x="110" y="92" width="24" height="18" rx="4" fill="#38bdf8" opacity="0.9" />
        <rect x="150" y="92" width="24" height="18" rx="4" fill="#38bdf8" opacity="0.9" />
        <rect x="190" y="92" width="24" height="18" rx="4" fill="#38bdf8" opacity="0.9" />
        <rect x="230" y="92" width="24" height="18" rx="4" fill="#38bdf8" opacity="0.9" />
        <rect x="270" y="92" width="24" height="18" rx="4" fill="#38bdf8" opacity="0.9" />
        <path d="M 50 140 L 330 140" stroke="#1e3a8a" strokeWidth="4" />
        <rect x="50" y="42" width="280" height="42" rx="10" fill="#0b0f17" stroke="#2563eb" strokeWidth="4" />
        <polygon points="65,44 85,44 70,82 50,82" fill="#38bdf8" />
        <polygon points="115,44 135,44 120,82 100,82" fill="#38bdf8" />
        <polygon points="165,44 185,44 170,82 150,82" fill="#38bdf8" />
        <polygon points="215,44 235,44 220,82 200,82" fill="#38bdf8" />
        <polygon points="265,44 285,44 270,82 250,82" fill="#38bdf8" />
        <polygon points="315,44 330,44 320,82 300,82" fill="#38bdf8" />
      </g>
      <g>
        <circle cx="290" cy="270" r="110" fill="url(#logoLens)" stroke="#38bdf8" strokeWidth="10" />
        <line x1="375" y1="355" x2="455" y2="435" stroke="#38bdf8" strokeWidth="26" strokeLinecap="round" />
        <line x1="375" y1="355" x2="455" y2="435" stroke="#1d4ed8" strokeWidth="14" strokeLinecap="round" />
        <path d="M 235 220 A 75 75 0 0 1 330 200" fill="none" stroke="#22c55e" strokeWidth="10" strokeLinecap="round" opacity="0.85" />
        <polygon points="275,245 320,270 275,295" fill="#22c55e" />
      </g>
    </svg>
  );
}
