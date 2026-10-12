import { describe, expect, it } from 'vitest';
import { t } from '.';
import { AR } from './ar';
describe('i18n', () => {
  it('English text is the key and fills placeholders', () => { expect(t('{n} days · back {d}', { n: 3, d: 'x' })).toBe('3 days · back x'); });
  it('every Arabic entry has text', () => { for (const [k, v] of Object.entries(AR)) expect(v.trim(), k).not.toBe(''); });
});
