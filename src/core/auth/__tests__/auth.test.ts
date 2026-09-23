import { describe, expect, it } from 'vitest';
import { loginEmail } from '..';

describe('login identifier', () => {
  it('turns a short username into its login address', () => {
    expect(loginEmail('ajr015')).toBe('ajr015@manpower-control.local');
    expect(loginEmail('  AJR015 ')).toBe('ajr015@manpower-control.local');
  });
  it('uses an email address as typed', () => {
    expect(loginEmail('Someone@Example.com')).toBe('someone@example.com');
  });
});
