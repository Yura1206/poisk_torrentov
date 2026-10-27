import { describe, expect, it } from 'vitest';
import { parseAndNormalizeRuTrackerCookies } from './cookies';

describe('parseAndNormalizeRuTrackerCookies', () => {
  it('parses standard cookie header string', () => {
    const input = 'bb_data=s%3A12345-6789%3Aabcd; bb_ssl=1; cf_clearance=test_clearance';
    const res = parseAndNormalizeRuTrackerCookies(input);
    expect(res.bbData).toBe('s%3A12345-6789%3Aabcd');
    expect(res.cookieHeader).toContain('bb_data=s%3A12345-6789%3Aabcd');
    expect(res.cookieHeader).toContain('bb_ssl=1');
  });

  it('strips leading "Cookie:" prefix', () => {
    const input = 'Cookie: bb_data=s%3Atoken123; bb_session=abc';
    const res = parseAndNormalizeRuTrackerCookies(input);
    expect(res.bbData).toBe('s%3Atoken123');
    expect(res.bbSession).toBe('abc');
    expect(res.cookieHeader).toBe('bb_data=s%3Atoken123; bb_session=abc');
  });

  it('parses JSON array from browser extension export', () => {
    const json = JSON.stringify([
      { name: 'bb_data', value: 's%3Amy_secret_token' },
      { name: 'bb_session', value: 'session_xyz' }
    ]);
    const res = parseAndNormalizeRuTrackerCookies(json);
    expect(res.bbData).toBe('s%3Amy_secret_token');
    expect(res.bbSession).toBe('session_xyz');
    expect(res.cookieHeader).toBe('bb_data=s%3Amy_secret_token; bb_session=session_xyz');
  });

  it('handles tab-separated rows copied from DevTools table', () => {
    const input = 'bb_data\ts%3Adevtool_token\t.rutracker.org\t/\tMedium\ncf_clearance\tcf_val\t.rutracker.org';
    const res = parseAndNormalizeRuTrackerCookies(input);
    expect(res.bbData).toBe('s%3Adevtool_token');
    expect(res.cookieHeader).toBe('bb_data=s%3Adevtool_token; cf_clearance=cf_val');
  });

  it('parses cookies table directly from user screenshot with bb_session and cf_clearance', () => {
    const tableText =
      'bb_guid\tL9stq6vpz4Vy\t.rutracker.org\t/forum/\t2027\t19\n' +
      'bb_session\t0-55766863-ibkGdkA4tkz...\t.rutracker.org\t/forum/\t2027\t41\n' +
      'bb_ssl\t1\t.rutracker.org\t/forum/\t2027\t7\n' +
      'cf_clearance\tDC65xSpfevLu.B4kXvtf7b...\t.rutracker.org\t/\t2027\t545';
    const res = parseAndNormalizeRuTrackerCookies(tableText);
    expect(res.cookieHeader).toContain('bb_guid=L9stq6vpz4Vy');
    expect(res.cookieHeader).toContain('bb_session=0-55766863-ibkGdkA4tkz...');
    expect(res.cookieHeader).toContain('bb_ssl=1');
    expect(res.cookieHeader).toContain('cf_clearance=DC65xSpfevLu.B4kXvtf7b...');
    expect(res.bbSession).toBe('0-55766863-ibkGdkA4tkz...');
  });

  it('handles raw bb_data token value without name', () => {
    const input = 's%3A2847583-1729871625%3Af5e8841a1a5b8e9d';
    const res = parseAndNormalizeRuTrackerCookies(input);
    expect(res.bbData).toBe('s%3A2847583-1729871625%3Af5e8841a1a5b8e9d');
    expect(res.cookieHeader).toBe('bb_data=s%3A2847583-1729871625%3Af5e8841a1a5b8e9d');
  });

  it('handles empty input gracefully', () => {
    const res = parseAndNormalizeRuTrackerCookies('   ');
    expect(res.cookieHeader).toBe('');
    expect(res.bbData).toBeUndefined();
  });
});
