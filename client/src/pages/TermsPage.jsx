import { Link } from 'react-router-dom';

import { ROUTES } from '../config/appConfig.js';
import { useSession } from '../hooks/useSession.jsx';

/** Terms of use — short, readable, and honest about what Yaar is. */
export function TermsPage() {
  const { app } = useSession();

  return (
    <div className="container">
      <div className="page fade-rise">
        <div className="page__header">
          <h1 className="page__title">Terms of use</h1>
          <p className="page__lead">Plain language, no fine-print tricks.</p>
        </div>

        <section className="section">
          <div className="section__body" style={{ padding: 20 }}>
            <div className="prose">
              <h2>1. What Yaar is</h2>
              <p>
                Yaar is an AI companion app for casual conversation. Your companion is a language model
                with a personality — it is not a human being, a therapist, a doctor or a lawyer.
              </p>

              <h2>2. Not a crisis service</h2>
              <p>
                Yaar cannot help in an emergency. If you are thinking about harming yourself or someone
                else, contact your local emergency number or a crisis helpline immediately, and tell
                someone you trust.
              </p>

              <h2>3. Using Yaar fairly</h2>
              <ul>
                <li>You get {app?.dailyMessageLimit ?? 20} messages per rolling 24-hour period.</li>
                <li>Do not try to bypass the limit, overload the service, or scrape it automatically.</li>
                <li>Do not use Yaar to harass, threaten, or harm yourself or anyone else.</li>
                <li>Do not send illegal content, or content sexualising minors.</li>
                <li>Do not rely on Yaar for medical, legal, financial or safety-critical decisions.</li>
              </ul>

              <h2>4. Your content</h2>
              <p>
                Your messages stay yours, and they are stored to keep your conversation working. You
                are responsible for what you choose to share — please do not send passwords, financial
                details or other people&apos;s private information.
              </p>

              <h2>5. Availability</h2>
              <p>
                Yaar depends on an AI provider and may be unavailable or slow at times. If a reply
                cannot be generated, that message is not counted against your daily limit. The service
                is provided &quot;as is&quot;, without warranties.
              </p>

              <h2>6. Changes</h2>
              <p>
                Features and these terms may change as Yaar evolves. Continuing to use the app after a
                change means you accept the updated terms.
              </p>

              <h2>7. Deleting your data</h2>
              <p>
                You can remove everything at any time from <Link to={ROUTES.settings}>Settings</Link>.
                See the <Link to={ROUTES.privacy}>privacy page</Link> for details on what is stored.
              </p>
            </div>
          </div>
        </section>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>
          Version {app?.version ?? '1.0.0'}
        </p>
      </div>
    </div>
  );
}

export default TermsPage;
