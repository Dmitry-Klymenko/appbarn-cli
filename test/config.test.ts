import { describe, expect, it } from 'vitest';
import { normalizeApiBase } from '../src/config';

describe('CLI API base', () => {
  it('requires encrypted remote transport', () => {
    expect(normalizeApiBase('https://api.app-barn.com')).toBe('https://api.app-barn.com');
    expect(normalizeApiBase('https://app.app-barn.com')).toBe('https://api.app-barn.com');
    expect(normalizeApiBase('https://staging.app.app-barn.com')).toBe('https://staging.api.app-barn.com');
    expect(() => normalizeApiBase('http://api.app-barn.com')).toThrow(/https/);
  });

  it('allows plaintext only on loopback', () => {
    expect(normalizeApiBase('http://localhost:8787/')).toBe('http://localhost:8787');
    expect(normalizeApiBase('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeApiBase('http://[::1]:8787')).toBe('http://[::1]:8787');
  });

  it('rejects URL credentials, query and fragment', () => {
    expect(() => normalizeApiBase('https://user:pass@api.app-barn.com')).toThrow();
    expect(() => normalizeApiBase('https://api.app-barn.com?token=x')).toThrow();
    expect(() => normalizeApiBase('https://api.app-barn.com#x')).toThrow();
    expect(() => normalizeApiBase('https://api.app-barn.com/api')).toThrow(/origin/u);
  });
});
