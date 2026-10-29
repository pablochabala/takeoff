import { useState } from 'react';
import { useInstallPrompt, type Platform } from '../lib/install';

const STEPS: Record<Exclude<Platform, 'other'>, { label: string; steps: string[] }> = {
  android: {
    label: 'Android',
    steps: [
      'Open this site in Chrome.',
      'Tap the ⋮ menu (top right).',
      'Tap “Install app” or “Add to Home screen”.',
      'Open TakeoffPro from your home screen.',
    ],
  },
  ios: {
    label: 'iPhone / iPad',
    steps: [
      'Open this site in Safari.',
      'Tap the Share button (square with an up arrow).',
      'Scroll down and tap “Add to Home Screen”.',
      'Tap “Add”, then open TakeoffPro from your home screen.',
    ],
  },
  windows: {
    label: 'Windows',
    steps: [
      'Open this site in Chrome or Edge.',
      'Click the install icon (⊕ / monitor with arrow) at the right of the address bar.',
      'Click “Install”. TakeoffPro opens in its own window and appears in the Start menu.',
    ],
  },
  mac: {
    label: 'Mac',
    steps: [
      'Chrome/Edge: click the install icon at the right of the address bar, then “Install”.',
      'Safari (macOS Sonoma or later): File → “Add to Dock”.',
      'TakeoffPro then opens from the Dock or Launchpad.',
    ],
  },
};

export default function InstallInstructions() {
  const { canPrompt, installed, platform, prompt } = useInstallPrompt();
  const [tab, setTab] = useState<Exclude<Platform, 'other'>>(platform === 'other' ? 'android' : platform);

  return (
    <div className="install-box">
      {installed ? (
        <p className="ok-text">✓ TakeoffPro is installed on this device.</p>
      ) : canPrompt ? (
        <button className="btn btn-accent" onClick={prompt}>Install TakeoffPro on this device</button>
      ) : null}
      <div className="tabs" role="tablist">
        {(Object.keys(STEPS) as Array<keyof typeof STEPS>).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
            {STEPS[k].label}
          </button>
        ))}
      </div>
      <ol className="steps">
        {STEPS[tab].steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
