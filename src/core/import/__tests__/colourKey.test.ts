import { describe, expect, it } from 'vitest';
import { colourMeaning, fillKey, majorityFill } from '../colourKey';

describe('monthly sheet colour key', () => {
  it('normalises SheetJS fills', () => {
    expect(fillKey({ rgb: 'FF00B050' })).toBe('rgb:00B050');
    expect(fillKey({ theme: 2, tint: -0.499984740745262, rgb: '948A54' })).toBe('theme:2:-0.5');
    expect(fillKey({ theme: 9, tint: 0.5999938962981048 })).toBe('theme:9:0.6');
    expect(fillKey({})).toBeNull();
  });
  it('maps the key to absence types; "go to other shift" is not an absence; unknown colours are null', () => {
    expect(colourMeaning('rgb:FF0000')).toMatchObject({ type: 'annual_leave_planned', absence: true });
    expect(colourMeaning('rgb:7030A0')?.type).toBe('annual_leave_rescheduled');
    expect(colourMeaning('rgb:00B0F0')?.type).toBe('special_leave');
    expect(colourMeaning('rgb:FFC000')?.type).toBe('long_course');
    expect(colourMeaning('theme:2:-0.5')?.type).toBe('course');
    expect(colourMeaning('theme:9:0.6')).toMatchObject({ absence: false, type: null });
    expect(colourMeaning('rgb:C00000')).toBeNull();
  });
  it('takes the colour most days carry', () => {
    expect(majorityFill(['rgb:FF0000', 'rgb:FF0000', 'rgb:00B050', null])).toBe('rgb:FF0000');
    expect(majorityFill([null, null])).toBeNull();
  });
});
