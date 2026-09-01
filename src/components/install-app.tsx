'use client';

import { useSyncExternalStore } from 'react';

/**
 * Installing the app, without making anyone hunt through a browser menu.
 *
 * Chrome fires `beforeinstallprompt` when a page is installable and lets you
 * hold onto the event and fire it later from your own button. iOS does not
 * implement any of that — Safari's Share → Add to Home Screen is the only way
 * in — so this component detects rather than pretends, and tells the truth on
 * each platform instead of showing a button that would do nothing.
 *
 * WHY A MODULE-LEVEL STORE AND NOT useEffect.
 * `beforeinstallprompt` fires once, early, and often before any component has
 * mounted. A listener registered in an effect misses it. Capturing it at module
 * scope and reading it with `useSyncExternalStore` also keeps us clear of
 * `react-hooks/set-state-in-effect`, a React Compiler rule this codebase
 * already trips eight times without adding a ninth for a button.
 */

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;

/**
 * Whether this browser already has the app installed. null until we know.
 *
 * THIS IS THE STATE THAT MATTERS AND IT IS EASY TO MISS. Chrome stops firing
 * `beforeinstallprompt` once the app is installed, and a phone browsing the
 * site in a Chrome tab is not in standalone display mode — so 'installed' and
 * 'this browser cannot install' look identical from JavaScript unless you ask.
 * Without this the page told an Android user who already had the app to scan a
 * QR code pointing at the page they were reading.
 *
 * `getInstalledRelatedApps` answers it on Chrome, and needs the manifest to
 * list itself under `related_applications`. Everywhere else it is absent and
 * we fall back to saying so rather than guessing.
 */
let installed: boolean | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Without this Chrome shows its own banner on its own schedule, which is
    // the behaviour we are replacing.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });

  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<unknown[]>;
  };
  if (nav.getInstalledRelatedApps) {
    nav
      .getInstalledRelatedApps()
      .then((apps) => {
        installed = apps.length > 0;
        emit();
      })
      .catch(() => {
        installed = null;
        emit();
      });
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const noopSubscribe = () => () => {};

/**
 * False during server render and the hydration pass, true afterwards. The
 * sanctioned way to render something browser-only without a mismatch — the
 * server and the first client render agree, then React re-renders.
 */
function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

function usePrompt() {
  return useSyncExternalStore(
    subscribe,
    () => deferred,
    () => null,
  );
}

function useInstalled() {
  return useSyncExternalStore(
    subscribe,
    () => installed,
    () => null,
  );
}

/** Android, or anything else handheld that is not iOS. */
function isMobile() {
  return /android/i.test(navigator.userAgent) || /Mobi/i.test(navigator.userAgent);
}

function isIOS() {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari's own flag, which predates the standard and is still the only
    // signal on iOS.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/* ------------------------------------------------------------ full panel */

export function InstallPanel() {
  const client = useIsClient();
  const prompt = usePrompt();
  const alreadyInstalled = useInstalled();

  if (!client) {
    return <div className="h-12" aria-hidden="true" />;
  }

  if (isStandalone()) {
    return (
      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
        You are already in the installed app.
      </p>
    );
  }

  if (alreadyInstalled) {
    return (
      <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
        <span className="font-semibold">Already installed on this device.</span> Look for the blue
        chevron — you are reading this in the browser rather than in the app.
      </p>
    );
  }

  if (prompt) {
    return (
      <button
        type="button"
        onClick={() => void prompt.prompt()}
        className="w-full rounded-xl bg-ink-900 px-5 py-3.5 text-base font-semibold text-white active:bg-ink-800"
      >
        Install Rooftop Auto
      </button>
    );
  }

  if (isIOS()) {
    return (
      <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-ink-200">
        <p className="mb-3 text-sm font-semibold text-ink-900">On iPhone, in Safari</p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li>
            <span className="mr-1.5 font-semibold text-ink-900">1.</span>
            Tap the Share button in the bottom bar
          </li>
          <li>
            <span className="mr-1.5 font-semibold text-ink-900">2.</span>
            Scroll down and tap <span className="font-semibold">Add to Home Screen</span>
          </li>
          <li>
            <span className="mr-1.5 font-semibold text-ink-900">3.</span>
            Tap <span className="font-semibold">Add</span>
          </li>
        </ol>
        <p className="mt-3 text-xs text-ink-500">
          Chrome on iPhone cannot do this — Apple only allows Safari to install an app.
        </p>
      </div>
    );
  }

  if (isMobile()) {
    return (
      <div className="rounded-xl bg-white p-4 ring-1 ring-inset ring-ink-200">
        <p className="mb-1 text-sm font-semibold text-ink-900">Check your home screen first</p>
        <p className="mb-3 text-xs leading-relaxed text-ink-500">
          Chrome stops offering to install an app once it is installed, so if the blue chevron is
          already on your home screen, you are done. If it is not:
        </p>
        <ol className="space-y-2 text-sm text-ink-700">
          <li>
            <span className="mr-1.5 font-semibold text-ink-900">1.</span>
            Tap the ⋮ menu, top right
          </li>
          <li>
            <span className="mr-1.5 font-semibold text-ink-900">2.</span>
            Tap <span className="font-semibold">Install and create shortcut</span>
          </li>
          <li>
            <span className="mr-1.5 font-semibold text-ink-900">3.</span>
            Choose <span className="font-semibold">Install</span> — not Create shortcut, which
            just reopens in Chrome
          </li>
        </ol>
      </div>
    );
  }

  // Desktop, or a browser that will not install. Say so rather than showing a
  // dead button.
  return (
    <div className="rounded-xl bg-white p-4 text-center ring-1 ring-inset ring-ink-200">
      <p className="text-sm font-semibold text-ink-900">Open this page on your phone</p>
      <p className="mt-1 mb-4 text-xs text-ink-500">
        The app installs to a phone&apos;s home screen. Scan this, or go to
        app.rooftopauto.com/install.
      </p>
      <img
        src="/install-qr.svg"
        alt="QR code for app.rooftopauto.com/install"
        width={180}
        height={180}
        className="mx-auto h-45 w-45 rounded-lg"
      />
    </div>
  );
}

/* --------------------------------------------------------- compact button */

/**
 * For the admin sidebar. Renders nothing at all unless there is something
 * useful to offer — a dealer already inside the installed app should never see
 * an invitation to install it.
 */
export function InstallButton() {
  const client = useIsClient();
  const prompt = usePrompt();
  const alreadyInstalled = useInstalled();

  if (!client || isStandalone() || alreadyInstalled) return null;

  if (prompt) {
    return (
      <button
        type="button"
        onClick={() => void prompt.prompt()}
        className="mt-2 w-full rounded-md bg-ink-800 px-2 py-1.5 text-left text-xs font-medium text-white hover:bg-ink-700"
      >
        Install app
      </button>
    );
  }

  if (isIOS()) {
    return (
      <a
        href="/install"
        className="mt-2 block rounded-md px-2 py-1.5 text-xs font-medium text-ink-300 hover:bg-ink-800 hover:text-white"
      >
        Add to home screen →
      </a>
    );
  }

  return null;
}
