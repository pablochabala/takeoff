import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CONSENT_TEXT, recordConsent } from '../lib/consent';

export default function ConsentDialog({ onAccepted, onCancel }: { onAccepted: () => void; onCancel: () => void }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 id="consent-title">Before you upload</h3>
          <button className="modal-x" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <p>TakeoffPro is free. To keep improving how accurately it calculates quantities, we collect:</p>
        <ul className="consent-list">
          <li>the drawings you upload (a copy is stored on our servers)</li>
          <li>the scales you set, the measurements you make and any corrections</li>
          <li>basic device and usage information (browser, screen size, time zone, which tools you use)</li>
          <li>Auto takeoff results; when you use Auto takeoff your drawings are read by our AI provider, Anthropic</li>
        </ul>
        <p className="muted small">
          We do not sell your data, and we do not collect your unit rates or payment details. You can ask us to delete your data at any time.
          Full details: <Link to="/privacy" target="_blank">Privacy Policy</Link> · <Link to="/terms" target="_blank">Terms of Service</Link>.
        </p>
        <label className="consent-check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{CONSENT_TEXT}</span>
        </label>
        <div className="modal-actions">
          <button
            className="btn btn-accent"
            disabled={!agree || busy}
            onClick={async () => {
              setBusy(true);
              await recordConsent();
              onAccepted();
            }}
          >
            {busy ? 'Saving…' : 'Agree and upload'}
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>Not now</button>
        </div>
      </div>
    </div>
  );
}
