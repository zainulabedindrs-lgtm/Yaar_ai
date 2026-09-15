import { useState } from 'react';

/**
 * Companion avatar with a graceful fallback.
 *
 * If the artwork is missing the component degrades to a gradient circle with
 * the companion's initials, so the UI never shows a broken image.
 *
 * @param {Object} props
 * @param {{ displayName?: string, avatar?: string, theme?: { from: string, to: string } }} props.companion
 * @param {'sm'|'md'|'lg'|'xl'} [props.size]
 * @param {boolean} [props.presence]  shows the small green online dot
 * @param {string} [props.className]
 */
export function Avatar({ companion, size = 'md', presence = false, className = '' }) {
  /** 0 = primary artwork, 1 = PNG fallback, 2 = initials. */
  const [stage, setStage] = useState(0);
  const name = companion?.displayName ?? 'Yaar';
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const style =
    companion?.theme?.from && companion?.theme?.to
      ? {
          backgroundImage: `linear-gradient(135deg, ${companion.theme.from} 0%, ${companion.theme.to} 100%)`,
        }
      : undefined;

  const sources = [companion?.avatar, companion?.avatarFallback].filter(Boolean);
  const source = sources[stage];

  return (
    <span
      className={`avatar avatar--${size} ${className}`.trim()}
      style={style}
      role="img"
      aria-label={`${name} avatar`}
    >
      {source ? (
        <img
          className="avatar__img"
          src={source}
          alt=""
          width={92}
          height={92}
          loading="lazy"
          decoding="async"
          onError={() => setStage((current) => current + 1)}
        />
      ) : (
        <span className="avatar__initials" aria-hidden="true">
          {initials}
        </span>
      )}
      {presence ? <span className="avatar__presence" aria-hidden="true" /> : null}
    </span>
  );
}

export default Avatar;
