import { useNavigate } from 'react-router-dom';

import { LAST_COMPANION_STORAGE_KEY } from '@shared/errors';

import Brand from '../components/Brand.jsx';
import CompanionCard from '../components/CompanionCard.jsx';
import { ErrorState, LoadingState } from '../components/States.jsx';
import UsageMeter from '../components/UsageMeter.jsx';
import { ROUTES } from '../config/appConfig.js';
import { useSession } from '../hooks/useSession.jsx';
import { writeStorage } from '../utils/storage.js';

/**
 * Home screen — brand, tagline, usage, and the two companion cards.
 *
 * Data comes from the single `/api/session` boot request, so navigating here is
 * instant after the first load.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { status, companions, usage, conversations, error, reload, app } = useSession();

  if (status === 'loading') {
    return (
      <div className="container">
        <LoadingState label="Warming up your Yaar…" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <ErrorState title="Could not reach Yaar" error={error} onRetry={() => reload()} />
      </div>
    );
  }

  const startChat = (companionId) => {
    writeStorage(LAST_COMPANION_STORAGE_KEY, companionId);
    navigate(ROUTES.chat(companionId));
  };

  /** Message counts per companion (used for the "Continue chat" affordance). */
  const countsByCompanion = new Map(
    (conversations ?? []).map((conversation) => [conversation.companionId, conversation.messageCount]),
  );

  return (
    <div className="container">
      <div className="home fade-rise">
        <div className="home__hero">
          <Brand />
          <h1 className="home__title">
            Someone to talk to, <span>anytime</span>.
          </h1>
          <p className="home__subtitle">
            Feeling bored? Need to talk? Pick your Yaar and start a conversation — in English, Urdu,
            Hindi, or however you like to talk.
          </p>
          {usage ? (
            <div className="home__usage" style={{ width: '100%', maxWidth: 420 }}>
              <UsageMeter usage={usage} />
            </div>
          ) : null}
        </div>

        <div className="home__cards">
          {companions.map((companion) => (
            <CompanionCard
              key={companion.id}
              companion={companion}
              messageCount={countsByCompanion.get(companion.id) ?? 0}
              onStart={() => startChat(companion.id)}
            />
          ))}
        </div>

        <p className="home__hint">
          You get {app?.dailyMessageLimit ?? 20} free messages every 24 hours. Your chats are saved on
          this device — only you can see them.
        </p>

        <div className="home__footer">
          Yaar is an AI companion, not a real person. If you are in crisis, please talk to someone you
          trust or a local helpline. <br />
          <a href={ROUTES.privacy}>Privacy</a> · <a href={ROUTES.terms}>Terms</a> · v
          {app?.version ?? '1.0.0'}
        </div>
      </div>
    </div>
  );
}

export default HomePage;
