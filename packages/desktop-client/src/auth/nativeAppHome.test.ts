import { nativeAppHomeUrl } from './nativeAppHome';

// production-identities: "Sign-out in the iOS app returns to the app's sign-in screen"
describe('nativeAppHomeUrl', () => {
  it('sends the server-hosted page in the iOS app back to the app', () => {
    expect(
      nativeAppHomeUrl({
        WEBVIEW_SERVER_URL: 'capacitor://localhost',
        location: { href: 'https://actual.example.test/' },
      }),
    ).toBe('capacitor://localhost/');
  });

  it("leaves the app's own pages alone", () => {
    expect(
      nativeAppHomeUrl({
        WEBVIEW_SERVER_URL: 'capacitor://localhost',
        location: { href: 'capacitor://localhost/budget' },
      }),
    ).toBeNull();
  });

  it('leaves a browser alone', () => {
    expect(
      nativeAppHomeUrl({ location: { href: 'https://actual.example.test/' } }),
    ).toBeNull();
  });
});
