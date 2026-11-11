// Fork-only (sc-3584, ADR 11). The page side of the native bridge: Swift
// calls `window.__actualNativeBridge.call(name, args)` and gets the result as
// JSON. The security boundary is the Swift-side allowlist
// (NativeBridgeAllowlist in NativeBridgeClient.swift), which refuses a name
// before it reaches the page. This page-side check only catches mistakes: a
// compromised page can call `send` directly. The Swift tests check that both
// lists match src/data/native-bridge-allowlist.json.
import { listen, send } from '@actual-app/core/platform/client/connection';

import allowlist from '#data/native-bridge-allowlist.json';

type Send = (name: string, args?: unknown) => Promise<unknown>;
type Listen = (name: string, cb: (payload: unknown) => void) => () => void;
type Notify = (message: { event: string; payload: unknown }) => void;

type NativeBridge = {
  call: (name: string, args?: unknown) => Promise<string>;
};

type BridgeWindow = {
  webkit?: {
    messageHandlers?: { actualNativeBridge?: { postMessage: Notify } };
  };
  __actualNativeBridge?: NativeBridge;
};

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    __actualNativeBridge?: NativeBridge;
  }
}

const EVENTS = ['cells-changed', 'sync-event'];

export function createNativeBridge({
  send: forward,
  listen: subscribe,
  notify,
}: {
  send: Send;
  listen: Listen;
  notify: Notify;
}): NativeBridge {
  for (const event of EVENTS) {
    subscribe(event, payload => notify({ event, payload }));
  }
  return {
    async call(name, args) {
      if (!allowlist.includes(name)) {
        throw new Error(`native bridge: ${name} is not allowlisted`);
      }
      return JSON.stringify(await forward(name, args));
    },
  };
}

export function installNativeBridge(win: BridgeWindow) {
  const handler = win.webkit?.messageHandlers?.actualNativeBridge;
  if (!handler) return;

  // send and listen are typed per handler name; the bridge is dynamic by design
  win.__actualNativeBridge = createNativeBridge({
    send: send as unknown as Send,
    listen: listen as unknown as Listen,
    notify: message => handler.postMessage(message),
  });
}
