import { describe, expect, it } from 'vitest';
import { kindOf } from '../busy';

describe('saving or loading', () => {
  const R = 'https://x.supabase.co/rest/v1';
  it('a change is a save, a read is a load, the background calls are not shown', () => {
    expect(kindOf(`${R}/trk_equipment?id=eq.1`, 'PATCH')).toBe('save');
    expect(kindOf(`${R}/trk_event`, 'POST')).toBe('save');
    expect(kindOf(`${R}/rpc/trk_set_order`, 'POST')).toBe('save');
    expect(kindOf(`${R}/trk_activities?select=*`, 'GET')).toBe('load');
    expect(kindOf(`${R}/rpc/trk_sd_team`, 'POST')).toBe('load');
    expect(kindOf(`${R}/rpc/app_visit`, 'POST')).toBeNull();
    expect(kindOf('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST')).toBeNull();
  });
});
