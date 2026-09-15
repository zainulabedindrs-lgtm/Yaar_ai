import { Avatar } from './Avatar.jsx';
import { ChatIcon } from './icons.jsx';

/**
 * Large premium card on the home screen: one per companion.
 *
 * @param {Object} props
 * @param {any} props.companion      public companion metadata from the API
 * @param {number} [props.messageCount]
 * @param {() => void} props.onStart
 */
export function CompanionCard({ companion, messageCount = 0, onStart }) {
  const hasHistory = messageCount > 1;

  return (
    <article
      className="companion-card"
      data-accent={companion.id}
      data-testid={`companion-card-${companion.id}`}
    >
      <div className="companion-card__top">
        <Avatar companion={companion} size="xl" presence />
        <div className="companion-card__meta">
          <div className="companion-card__label">{companion.label}</div>
          <div className="companion-card__name">{companion.displayName}</div>
          <div className="companion-card__tagline">{companion.tagline}</div>
        </div>
      </div>

      <p className="companion-card__desc">{companion.description}</p>

      <div className="companion-card__traits">
        {(companion.traits ?? []).map((trait) => (
          <span className="chip" key={trait}>
            {trait}
          </span>
        ))}
        {hasHistory ? <span className="chip chip--accent">Continue chat</span> : null}
      </div>

      <div className="companion-card__actions">
        <button
          type="button"
          className="button button--primary button--block"
          onClick={onStart}
          style={{ backgroundImage: `linear-gradient(135deg, ${companion.theme?.from ?? '#ff9fbe'}, ${companion.theme?.to ?? '#ff5f8f'})` }}
        >
          <ChatIcon width={18} height={18} />
          {hasHistory ? 'Continue chat' : 'Start chat'}
        </button>
      </div>
    </article>
  );
}

export default CompanionCard;
