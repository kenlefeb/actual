// openid-true-sign-out task 4.1, phone width. The mobile app (Capacitor) runs
// this same web build in a WebView, so this also covers its sign-out path.
import { describeOpenIdSignOut } from './openid-sign-out';

describeOpenIdSignOut({ width: 390, height: 844 });
