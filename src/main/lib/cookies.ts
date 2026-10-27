export interface ParsedCookiesResult {
  cookieHeader: string;
  bbData?: string;
  bbSession?: string;
}

export function parseAndNormalizeRuTrackerCookies(input: string): ParsedCookiesResult {
  let str = input.trim();
  if (!str) return { cookieHeader: '' };

  // Case 1: JSON array from browser extension (e.g. Cookie-Editor / EditThisCookie)
  if (str.startsWith('[') && str.endsWith(']')) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) {
        const pairs: string[] = [];
        let bbData: string | undefined;
        let bbSession: string | undefined;
        for (const item of arr) {
          if (item && typeof item.name === 'string' && typeof item.value === 'string') {
            const name = item.name.trim();
            const value = item.value.trim();
            pairs.push(`${name}=${value}`);
            if (name === 'bb_data') bbData = value;
            if (name === 'bb_session') bbSession = value;
          }
        }
        if (pairs.length > 0) {
          return { cookieHeader: pairs.join('; '), bbData, bbSession };
        }
      }
    } catch {
      // not JSON, fallback to text parsing
    }
  }

  // Case 2: Stripping HTTP request prefix if copied from DevTools Network
  if (str.toLowerCase().startsWith('cookie:')) {
    str = str.slice(7).trim();
  }

  // Split lines
  const lines = str.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  const pairs: string[] = [];
  let bbData: string | undefined;
  let bbSession: string | undefined;

  for (const line of lines) {
    // If line has semicolons, split them
    const segments = line.includes(';') ? line.split(';').map((s) => s.trim()).filter(Boolean) : [line];
    for (const seg of segments) {
      // Check if it's tab-separated (copying row from DevTools table: Name \t Value \t Domain ...)
      if (seg.includes('\t')) {
        const parts = seg.split('\t').map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          const name = parts[0];
          const val = parts[1];
          pairs.push(`${name}=${val}`);
          if (name === 'bb_data') bbData = val;
          if (name === 'bb_session') bbSession = val;
          continue;
        }
      }

      const eqIdx = seg.indexOf('=');
      if (eqIdx > 0) {
        const name = seg.slice(0, eqIdx).trim();
        const value = seg.slice(eqIdx + 1).trim();
        pairs.push(`${name}=${value}`);
        if (name === 'bb_data') bbData = value;
        if (name === 'bb_session') bbSession = value;
      } else if (seg.length > 15 && !bbData && !bbSession) {
        if (seg.startsWith('0-')) {
          bbSession = seg;
          pairs.push(`bb_session=${seg}`);
        } else {
          bbData = seg;
          pairs.push(`bb_data=${seg}`);
        }
      }
    }
  }

  return {
    cookieHeader: pairs.join('; '),
    bbData,
    bbSession
  };
}
