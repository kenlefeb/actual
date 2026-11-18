// fork: sc-4962. Operator-configured OpenID return origins.
import { validReturnOrigins } from './return-origins';

describe('validReturnOrigins', () => {
  it('keeps plain origins, normalised', () => {
    expect(
      validReturnOrigins([
        'https://Budget.example.org/',
        'https://budget.example.org:8443',
        'myapp://localhost',
      ]),
    ).toEqual([
      'https://budget.example.org',
      'https://budget.example.org:8443',
      'myapp://localhost',
    ]);
  });

  it.each([
    ['an empty host', 'foo:bar'],
    ['an empty authority', 'foo://'],
    ['userinfo', 'https://user@budget.example.org'],
    ['a path', 'https://budget.example.org/app'],
    ['a query', 'https://budget.example.org?x=1'],
    ['an empty query', 'https://budget.example.org?'],
    ['a fragment', 'https://budget.example.org#x'],
    ['a wildcard', 'https://*.example.org'],
    ['not a URL', 'budget.example.org'],
    ['an empty string', ''],
  ])('drops an entry with %s and logs only its index', (_name, entry) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(validReturnOrigins(['https://ok.example', entry])).toEqual([
        'https://ok.example',
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('1');
      if (entry) {
        expect(logged).not.toContain(entry);
      }
    } finally {
      warn.mockRestore();
    }
  });
});
