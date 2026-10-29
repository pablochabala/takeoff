import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { POLICY_VERSION } from '../lib/consent';

// DRAFT legal text. Fill in every [BRACKETED] item and have a Zambian lawyer review
// before launch. No policy can guarantee you will never be sued; what protects you is
// collecting only what you say, getting recorded consent, and honouring user rights.

const OWNER = '[YOUR FULL LEGAL NAME / COMPANY NAME]';
const ADDRESS = '[PHYSICAL ADDRESS, TOWN, ZAMBIA]';
const EMAIL = '[CONTACT EMAIL]';

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="doc-page">
      <header className="doc-head"><Logo /></header>
      <main className="doc-body legal">
        <h1>{title}</h1>
        <p className="muted small">Version {POLICY_VERSION} · Effective {POLICY_VERSION}</p>
        {children}
        <p><Link to="/">← Back to home</Link></p>
      </main>
    </div>
  );
}

export function Privacy() {
  return (
    <LegalShell title="Privacy Policy">
      <p>
        This Privacy Policy explains what personal data and other information TakeoffPro (“the App”, “we”, “us”) collects,
        why we collect it, how long we keep it, who we share it with, and the rights you have. It is written to meet the
        requirements of the <strong>Data Protection Act No. 3 of 2021 of the Republic of Zambia</strong> and is intended to be
        consistent with other widely used data protection standards.
      </p>
      <p><strong>Please read it carefully. By ticking the consent box in the App you agree to the collection and use of your information as described here.</strong> If you do not agree, do not upload drawings or create an account.</p>

      <h2>1. Who we are (data controller)</h2>
      <p>
        The data controller is {OWNER}, {ADDRESS}. Contact for all privacy matters: <strong>{EMAIL}</strong>.
        [If registered: Data controller registration number with the Office of the Data Protection Commissioner: ______.]
      </p>

      <h2>2. What we collect</h2>
      <p>We collect only the information listed below. We collect it every time you use the App, after you have given consent.</p>
      <table className="legal-table">
        <thead><tr><th>Category</th><th>Examples</th><th>When</th></tr></thead>
        <tbody>
          <tr><td>Drawings you upload</td><td>A copy of each PDF, PNG, JPG or camera photo you upload, with its file name, size and page dimensions</td><td>When you upload</td></tr>
          <tr><td>Takeoff &amp; accuracy data</td><td>Scales you set (preset or calibrated, including the points and known length used), measurement shapes and coordinates, measurement types, categories, names, descriptions, depths, timesing, waste percentages, the calculated quantities, edits, corrections, deletions, undo/redo</td><td>As you work</td></tr>
          <tr><td>Auto takeoff data</td><td>The page images and text sent for automatic takeoff, and the takeoff the AI returns (items, dimensions, assumptions), plus run time and usage counts</td><td>When you use Auto takeoff</td></tr>
          <tr><td>Usage information</td><td>Which tools and pages you use, export attempts, session start time, app version</td><td>As you work</td></tr>
          <tr><td>Device information</td><td>Browser and operating system (user agent), screen size, language, time zone, whether the App is installed, touch support, a random device identifier stored in your browser</td><td>Each session</td></tr>
          <tr><td>Account information (only if you sign up)</td><td>Name, email address, company, unit and currency preferences, and your Google profile name and email if you sign in with Google</td><td>When you sign up or edit your account</td></tr>
          <tr><td>Consent records</td><td>The policy version and exact wording you agreed to, date and time, device identifier, browser</td><td>When you give consent</td></tr>
        </tbody>
      </table>
      <p><strong>We do not collect:</strong> your unit rates or prices, payment card or mobile-money details, your precise location (GPS), your contacts, or any sensitive personal data as defined by the Act. We do not knowingly collect information from children.</p>
      <p>
        Drawings can themselves contain personal data about other people (for example a client’s name, a plot number or an
        architect’s contact details in the title block). You are responsible for having the right to upload them — see our{' '}
        <Link to="/terms">Terms of Service</Link>.
      </p>

      <h2>3. Why we use it (purposes)</h2>
      <ul>
        <li><strong>To provide the App</strong> — show your drawings, calculate quantities and costs (including automatic takeoff by AI when you ask for it), save and sync your work, and let you sign in.</li>
        <li><strong>To improve calculation accuracy</strong> — analyse uploaded drawings, scales, measurements and user corrections to find and fix errors, test new features (for example automatic scale detection), and build better measuring tools. This may include training and testing software and statistical or machine-learning models.</li>
        <li><strong>To keep the App secure and working</strong> — detect abuse, fix bugs, and understand performance.</li>
        <li><strong>To meet legal obligations</strong> and to establish, exercise or defend legal claims.</li>
      </ul>
      <p>We will not use your information for a new purpose that is incompatible with these purposes without telling you and, where required, asking for your consent again.</p>

      <h2>4. Legal basis</h2>
      <ul>
        <li><strong>Consent</strong> — you give it by ticking the consent box before your first upload or when creating an account. We keep a record of it.</li>
        <li><strong>Performance of a contract</strong> — to provide the App you asked to use.</li>
        <li><strong>Legitimate interests</strong> — keeping the App secure and improving it, where these are not overridden by your rights.</li>
        <li><strong>Legal obligation</strong> — where the law requires us to keep or disclose information.</li>
      </ul>

      <h2>5. Where your data is stored</h2>
      <p>
        Your work is stored on your own device (browser storage) so the App works offline. Collected information is sent to
        and stored with our hosting provider <strong>Supabase</strong> [region: ______]. These servers may be located outside
        Zambia. <strong>By giving consent you agree to this transfer.</strong> We only use providers that apply appropriate
        security safeguards and that process data on our instructions under contract.
      </p>

      <h2>6. Who we share it with</h2>
      <ul>
        <li>Service providers that host and run the App (Supabase for database, storage and sign-in; Google if you choose Google sign-in; our web hosting provider; our email provider).</li>
        <li><strong>Anthropic PBC</strong> (USA), our AI provider: when you use Auto takeoff, the drawings you select are sent to Anthropic’s API to be read and returned as a takeoff. Anthropic processes them on our behalf under its commercial terms and does not use API data to train its models by default; it may retain inputs and outputs for a limited period for safety and abuse monitoring.</li>
        <li>Professional advisers, authorities or courts where required by law or to protect our legal rights.</li>
        <li>A buyer or successor if the App or business is sold or reorganised, under the same protections.</li>
      </ul>
      <p><strong>We do not sell your personal data.</strong> We may publish or share aggregated or de-identified statistics (for example “average scale error on A3 PDFs”) that cannot reasonably be used to identify you.</p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li>Account information: while your account is active, then deleted within 90 days of account deletion.</li>
        <li>Uploaded drawings and accuracy/usage data: up to <strong>3 years</strong> from collection, then deleted or irreversibly de-identified.</li>
        <li>Consent records: for as long as we hold data based on that consent, plus 6 years, as evidence.</li>
        <li>Data on your device: until you clear it (“Start over”) or clear your browser data.</li>
      </ul>

      <h2>8. Security</h2>
      <p>
        We use encrypted connections (HTTPS), access controls so that collected research data can only be read by authorised
        administrators, and reputable hosting providers. No system is completely secure; if a breach likely to affect your
        rights occurs, we will notify the Data Protection Commissioner and affected users as required by law.
      </p>

      <h2>9. Your rights</h2>
      <p>Under the Data Protection Act you have the right to:</p>
      <ul>
        <li>be informed about how your data is used (this policy);</li>
        <li>access a copy of your personal data;</li>
        <li>have inaccurate data corrected;</li>
        <li>have your data deleted;</li>
        <li><strong>withdraw your consent at any time</strong> — this stops future collection but does not affect use before withdrawal;</li>
        <li>object to or restrict certain processing, and to data portability where applicable;</li>
        <li>not be subject to a decision based solely on automated processing that significantly affects you;</li>
        <li>complain to the <strong>Office of the Data Protection Commissioner</strong> of Zambia.</li>
      </ul>
      <p>
        To use any right, email <strong>{EMAIL}</strong> from your account email (or include your device identifier, shown in
        Account settings, for guest use). We reply within <strong>30 days</strong>. We may need to verify your identity first.
      </p>

      <h2>10. Browser storage</h2>
      <p>
        The App uses your browser’s local storage and IndexedDB to save your work, preferences, consent choice, a random
        device identifier and a queue of information waiting to be sent when you are back online. We do not use advertising
        or third-party tracking cookies.
      </p>

      <h2>11. Children</h2>
      <p>The App is intended for construction professionals and students aged 18 or over. Do not use it if you are under 18.</p>

      <h2>12. Changes</h2>
      <p>
        We may update this policy. The version date is shown at the top. If we make a material change, the App will ask you
        to agree again before collecting more data.
      </p>

      <h2>13. Contact</h2>
      <p>{OWNER} · {ADDRESS} · {EMAIL}</p>
    </LegalShell>
  );
}

export function Terms() {
  return (
    <LegalShell title="Terms of Service">
      <p>These Terms are an agreement between you and {OWNER} (“we”, “us”) for use of TakeoffPro (“the App”). By using the App you accept them. If you do not accept them, do not use the App.</p>

      <h2>1. The service</h2>
      <p>TakeoffPro is a free tool for measuring quantities from construction drawings. We may change, suspend or stop any part of it at any time. We may introduce paid features in future; if so, we will tell you first and you will never be charged without agreeing.</p>

      <h2>2. Eligibility and accounts</h2>
      <p>You must be 18 or over. If you create an account you must give accurate information and keep your password secure. You are responsible for activity on your account.</p>

      <h2>3. Your drawings — your responsibility</h2>
      <p>You keep ownership of drawings you upload. By uploading a drawing you <strong>confirm that you own it or have permission</strong> from the copyright owner (for example the architect or engineer) and from any person whose personal information appears in it, to upload it and to allow the uses described in these Terms and the Privacy Policy.</p>
      <p>
        You grant us a worldwide, royalty-free, non-exclusive, perpetual (subject to deletion requests under the Privacy
        Policy) licence to store, copy, analyse and process the drawings and measurement data you provide in order to run
        the App and to improve its accuracy, including by developing and testing software and models. We will not publish
        your drawings or give them to third parties except as described in the Privacy Policy.
      </p>

      <h2>4. Acceptable use</h2>
      <p>Do not upload unlawful material, material you have no right to use, malware, or content unrelated to construction drawings; do not attempt to disrupt, overload, reverse engineer or gain unauthorised access to the App or other users’ data.</p>

      <h2>5. Accuracy — please check your results</h2>
      <p>
        <strong>The App is a measuring aid, not professional advice.</strong> Quantities depend on the drawing, the scale you
        set (many PDFs are not printed at true scale) and how you measure. Results may contain errors. You are solely
        responsible for checking all quantities, rates and costs before using them for tenders, orders, contracts,
        valuations or any other purpose.
      </p>

      <h2>6. No warranty</h2>
      <p>The App is provided free of charge “as is” and “as available”, without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy, or uninterrupted availability, to the fullest extent permitted by law.</p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we are not liable for any indirect, incidental, special or consequential loss,
        or for loss of profit, contracts, data or business, arising from use of or inability to use the App, including losses
        caused by inaccurate quantities or costs. Our total liability for any claim is limited to <strong>USD 50</strong>.
        Nothing in these Terms excludes liability that cannot be excluded by law.
      </p>

      <h2>8. Indemnity</h2>
      <p>You agree to indemnify us against claims, losses and costs (including reasonable legal fees) arising from drawings or information you upload without the right to do so, or from your breach of these Terms.</p>

      <h2>9. Termination</h2>
      <p>You may stop using the App and ask us to delete your account at any time. We may suspend or end your access if you breach these Terms.</p>

      <h2>10. Changes</h2>
      <p>We may update these Terms. The version date is shown at the top. Continuing to use the App after a change means you accept the updated Terms; material changes will be highlighted in the App.</p>

      <h2>11. Governing law and disputes</h2>
      <p>These Terms are governed by the laws of the Republic of Zambia. You and we will first try to resolve any dispute informally by contacting {EMAIL}; if not resolved within 30 days, the courts of Zambia have exclusive jurisdiction.</p>

      <h2>12. Contact</h2>
      <p>{OWNER} · {ADDRESS} · {EMAIL}</p>
    </LegalShell>
  );
}
