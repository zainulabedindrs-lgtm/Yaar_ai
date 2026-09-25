import { Link } from 'react-router-dom';

import { ROUTES } from '../config/appConfig.js';
import { useSession } from '../hooks/useSession.jsx';

/**
 * Privacy page. Written to describe exactly what the code does — if the data
 * model changes, this page must change with it (see README → Privacy).
 */
export function PrivacyPage() {
  const { ai } = useSession();

  return (
    <div className="container">
      <div className="page fade-rise">
        <div className="page__header">
          <h1 className="page__title">Privacy</h1>
          <p className="page__lead">Short version: your chats are yours, and we keep them small.</p>
        </div>

        <section className="section">
          <div className="section__body" style={{ padding: 20 }}>
            <div className="prose">
              <h2>What we store</h2>
              <ul>
                <li>
                  An <strong>anonymous session id</strong> derived from a random device id stored in
                  your browser. No name, email or phone number is required to use Yaar.
                </li>
                <li>
                  <strong>Your messages</strong> and your companion&apos;s replies, so your
                  conversation is still there when you come back.
                </li>
                <li>
                  <strong>Usage counters</strong> (how many messages you have sent in the current
                  24-hour window) with the window start and reset timestamps.
                </li>
              </ul>

              <h2>What we do not store</h2>
              <ul>
                <li>Passwords (there are none).</li>
                <li>Your message drafts — nothing is saved until you press send.</li>
                <li>Your contact list, photos, precise location or any device permissions.</li>
                <li>Advertising or analytics identifiers.</li>
              </ul>

              <h2>Where your words go</h2>
              <p>
                When you send a message, Yaar&apos;s server sends your recent conversation to the AI
                provider ({ai?.label ?? 'Hugging Face'}) so a reply can be generated. The API key
                lives only on the server — it is never shipped to your browser. Providers process the
                text under their own terms; if you would not be comfortable with that, avoid sharing
                identifying details.
              </p>

              <h2>Who can see your chats</h2>
              <p>
                Only you. Every conversation is keyed to your session, and the API verifies ownership
                on every read. Other users of Yaar can never open your conversation, and there is no
                public feed.
              </p>

              <h2>Deleting your data</h2>
              <p>
                In <Link to={ROUTES.settings}>Settings</Link> you can clear a single conversation or
                delete everything — the session, all messages, and the usage record. Deletion is
                immediate and permanent, with no soft-delete copy kept.
              </p>

              <h2>Children</h2>
              <p>
                Yaar is intended for people aged 13 and over. If you are younger, please talk to a
                parent, guardian or another adult you trust instead.
              </p>

              <h2>Security</h2>
              <p>
                Messages are transmitted over HTTPS in production, the AI credentials stay on the
                server, and the daily limit is enforced server-side so it cannot be edited from the
                browser.
              </p>
            </div>
          </div>
        </section>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>
          Questions about your data? See <Link to={ROUTES.about}>About Yaar</Link>.
        </p>
      </div>
    </div>
  );
}

export default PrivacyPage;
