// fork: sc-4962. Which return URLs may receive the OpenID sign-in token.
import { getAccountDb } from '#account-db';
import { config } from '#load-config';

import { isAllowedRedirectTarget, isValidRedirectUrl } from './openid';

const SERVER = 'https://actual.example';

beforeEach(() => {
  getAccountDb().mutate('DELETE FROM auth');
  getAccountDb().mutate(
    'INSERT INTO auth (method, active, extra_data) VALUES (?, 1, ?)',
    [
      'openid',
      JSON.stringify({
        issuer: 'https://identity.example',
        client_id: 'client',
        client_secret: 'secret',
        server_hostname: SERVER,
      }),
    ],
  );
});

afterEach(() => {
  getAccountDb().mutate('DELETE FROM auth');
  config.set('env', 'test');
  config.set('openId.allowedReturnOrigins', []);
});

describe('return URLs the sign-in accepts', () => {
  it.each([
    ['the served web app (server origin)', SERVER],
    ['the served web app with a trailing slash', `${SERVER}/`],
    ['the served web app with its default port spelled out', `${SERVER}:443`],
    ['the iPhone app', 'capacitor://localhost'],
    ['the Mac app', 'homeeconomics://localhost'],
    ['the Electron desktop app', 'http://localhost:3010'],
  ])('accepts %s', (_name, url) => {
    expect(isValidRedirectUrl(url)).toBe(true);
  });

  it('accepts the local web dev server only in development', () => {
    expect(isValidRedirectUrl('http://localhost:3001')).toBe(false);
    config.set('env', 'development');
    expect(isValidRedirectUrl('http://localhost:3001')).toBe(true);
  });

  it('accepts an origin the operator configured', () => {
    expect(isValidRedirectUrl('https://budget.example.org')).toBe(false);
    config.set('openId.allowedReturnOrigins', ['https://Budget.example.org/']);
    expect(isValidRedirectUrl('https://budget.example.org')).toBe(true);
    expect(isValidRedirectUrl('https://budget.example.org:8443')).toBe(false);
  });

  it.each([
    ['another scheme on localhost', 'myapp://localhost'],
    ['https on localhost', 'https://localhost'],
    ['another port on localhost', 'http://localhost:8080'],
    ['localhost without a port', 'http://localhost'],
    ['the dev server outside development', 'http://localhost:3001'],
    ['a path prefix on an app origin', 'capacitor://localhost/evil'],
    ['a path prefix on the server origin', `${SERVER}/evil`],
    ['a query on an app origin', 'homeeconomics://localhost?x=1'],
    ['a fragment on an app origin', 'http://localhost:3010#x'],
    ['a look-alike host', 'https://actual.example.evil.example'],
    ['another host', 'https://evil.example'],
    ['userinfo pointing elsewhere', `https://actual.example@evil.example`],
    ['userinfo on the server origin', `https://good@actual.example`],
    ['userinfo on an app origin', 'capacitor://good@localhost'],
    ['a scheme-relative URL', '//evil.example'],
    ['a trailing-dot host', 'https://actual.example.'],
    ['the server host on another port', `${SERVER}:8443`],
    ['the server host over http', 'http://actual.example'],
    ['an upper-case app host', 'capacitor://LOCALHOST'],
    ['127.0.0.1 for the Electron port', 'http://127.0.0.1:3010'],
    ['a data: URL', 'data:text/html,x'],
    ['nothing', undefined],
  ])('rejects %s', (_name, url) => {
    expect(isValidRedirectUrl(url)).toBe(false);
  });

  it('accepts mixed-case spellings that parse to an allowed origin', () => {
    expect(isValidRedirectUrl('HTTPS://ACTUAL.EXAMPLE')).toBe(true);
    expect(isValidRedirectUrl('CAPACITOR://localhost')).toBe(true);
  });

  it('rejects everything when OpenID has no server hostname', () => {
    getAccountDb().mutate('DELETE FROM auth');
    expect(isValidRedirectUrl('capacitor://localhost')).toBe(false);
  });
});

describe('callback redirect targets', () => {
  it.each([
    `${SERVER}/openid-cb?token=t`,
    'capacitor://localhost/openid-cb?token=t',
    'homeeconomics://localhost/openid-cb?token=t',
    'http://localhost:3010/openid-cb?token=t',
  ])('allows %s', url => {
    expect(isAllowedRedirectTarget(url)).toBe(true);
  });

  it.each([
    'myapp://localhost/openid-cb?token=t',
    'http://localhost:8080/openid-cb?token=t',
    'https://evil.example/openid-cb?token=t',
    'https://good@actual.example/openid-cb?token=t',
  ])('refuses %s', url => {
    expect(isAllowedRedirectTarget(url)).toBe(false);
  });
});
