import type { FilterState, SortState, TorrentResult } from '../../shared/types';

const compareOptional = (left?: number | string, right?: number | string): number => {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const a = typeof left === 'number' ? left : Date.parse(left);
  const b = typeof right === 'number' ? right : Date.parse(right);
  return a - b;
};

export const emptyFilters = (): FilterState => ({
  resolutions: [],
  dynamicRanges: [],
  seasons: [],
  parts: [],
  studios: [],
  language: 'all',
  providers: [],
  years: []
});

export function filterResults(results: TorrentResult[], filters: FilterState): TorrentResult[] {
  return results.filter((item) => {
    const hdrMatches = filters.dynamicRanges.includes('hdr') && ['hdr', 'hdr10', 'hdr10plus', 'dolby-vision'].includes(item.dynamicRange);
    return (!filters.resolutions.length || filters.resolutions.includes(item.resolution))
      && (!filters.dynamicRanges.length || filters.dynamicRanges.includes(item.dynamicRange) || hdrMatches)
      && (!filters.providers?.length || filters.providers.includes(item.providerId))
      && (!filters.years?.length || (item.year !== undefined && filters.years.includes(item.year)))
      && (!filters.seasons.length || (item.season !== undefined && filters.seasons.includes(item.season)))
      && (!filters.parts.length || (item.part !== undefined && filters.parts.includes(item.part)))
      && (!filters.studios.length || filters.studios.some((studio) => item.studios.includes(studio)))
      && (!filters.language || filters.language === 'all' || item.languageStatus === 'confirmed');
  });
}

export function sortResults(results: TorrentResult[], sort: SortState): TorrentResult[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...results].sort((left, right) => {
    let comparison = 0;
    switch (sort.field) {
      case 'title':
        comparison = left.title.localeCompare(right.title, 'ru');
        break;
      case 'seeds':
        comparison = compareOptional(left.seeds, right.seeds);
        break;
      case 'size':
        comparison = compareOptional(left.sizeBytes, right.sizeBytes);
        break;
      case 'published':
        comparison = compareOptional(left.publishedAt, right.publishedAt);
        break;
      case 'updated':
        comparison = compareOptional(left.updatedAt, right.updatedAt);
        break;
      case 'relevance':
      default: {
        comparison = left.relevance - right.relevance;
        if (comparison === 0) {
          comparison = (left.seeds ?? 0) - (right.seeds ?? 0);
        }
        if (comparison === 0 && left.publishedAt && right.publishedAt) {
          comparison = Date.parse(left.publishedAt) - Date.parse(right.publishedAt);
        }
        break;
      }
    }
    if (comparison === 0) return left.title.localeCompare(right.title, 'ru');

    // Неизвестные значения compareOptional всегда ставит в конец; направление их не переворачивает.
    const leftUnknown =
      sort.field === 'seeds' ? left.seeds === undefined :
      sort.field === 'size' ? left.sizeBytes === undefined :
      sort.field === 'published' ? left.publishedAt === undefined :
      sort.field === 'updated' ? left.updatedAt === undefined : false;

    const rightUnknown =
      sort.field === 'seeds' ? right.seeds === undefined :
      sort.field === 'size' ? right.sizeBytes === undefined :
      sort.field === 'published' ? right.publishedAt === undefined :
      sort.field === 'updated' ? right.updatedAt === undefined : false;

    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    return comparison * direction;
  });
}
