import { Link } from 'react-router-dom';

import Brand from '../components/Brand.jsx';
import UsageMeter from '../components/UsageMeter.jsx';
import { ROUTES } from '../config/appConfig.js';
import { useSession } from '../hooks/useSession.jsx';

/**
 * About screen — what Yaar is, how the limit works, how it is built, and the
 * safety notes a companion app owes its users.
 */
export function AboutPage() {
  const { app, ai, usage } = useSession();

  return (
    <div className="container">
      <div className="page fade-rise">
        <div className="page__header">
          <Brand withTagline />
          <h1 className="page__title" style={{ marginTop: 12 }}>
            About Yaar
          </h1>
          <p className="page__lead">
            Yaar is a warm AI companion for the moments when you feel bored, lonely, or simply want
            someone to talk to.
          </p>
        </div>

        <section className="section">
          <div className="section__body">
            <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <UsageMeter usage={usage} />
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">How it works</h2>
          <div className="section__body" style={{ padding: 20 }}>
            <div className="prose">
              <p>
                You pick a companion — <strong>Your Girlfriend</strong> or{' '}
                <strong>Your Boyfriend</strong> — and start chatting. Yaar answers in the language
                you use: English, اردو, हिन्दी, Roman Urdu or Hindi, or a mix of them.
              </p>
              <ul>
                <li>{app?.dailyMessageLimit ?? 20} of your messages every 24 hours, free.</li>
                <li>AI replies never count towards the limit.</li>
                <li>Your conversations are saved so you can pick up where you stopped.</li>
                <li>No passwords, no profiles, no ads.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">Honest notes</h2>
          <div className="section__body" style={{ padding: 20 }}>
            <div className="prose">
              <p>
                <strong>Yaar is an AI, not a person.</strong> The warmth is real in the sense that it
                is designed to be kind and supportive, but your companion has no life outside this
                chat.
              </p>
              <p>
                Because that matters, Yaar will never pretend to be human if you sincerely ask, never
                pressure you to keep chatting, and never encourage you to pull away from the people
                around you.
              </p>
              <p>
                If you are going through something heavy — self-harm, abuse, hopelessness — please talk
                to someone you trust or a local helpline. In an emergency, contact your local
                emergency number. Yaar can listen, but it cannot replace real help.
              </p>
              <p>
                The AI model currently answering you is{' '}
                <strong>{ai?.model ?? 'not configured'}</strong>
                {ai?.provider ? ` (${ai.provider})` : ''}.
              </p>
            </div>
          </div>
        </section>

        <section className="section">
          <h2 className="section__title">More</h2>
          <div className="section__body">
            <Link className="setting-row setting-row--action" to={ROUTES.privacy}>
              <div className="setting-row__body">
                <div className="setting-row__label">Privacy policy</div>
                <div className="setting-row__value">What is stored, and what is not.</div>
              </div>
            </Link>
            <Link className="setting-row setting-row--action" to={ROUTES.terms}>
              <div className="setting-row__body">
                <div className="setting-row__label">Terms of use</div>
                <div className="setting-row__value">The habits we ask you to keep.</div>
              </div>
            </Link>
            <Link className="setting-row setting-row--action" to={ROUTES.settings}>
              <div className="setting-row__body">
                <div className="setting-row__label">Settings</div>
                <div className="setting-row__value">Usage, session and your data.</div>
              </div>
            </Link>
          </div>
        </section>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>
          {app?.name ?? 'Yaar'} v{app?.version ?? '1.0.0'}
        </p>
      </div>
    </div>
  );
}

export default AboutPage;
