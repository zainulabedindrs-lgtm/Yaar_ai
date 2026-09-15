import { NavLink } from 'react-router-dom';

import { ROUTES } from '../config/appConfig.js';
import { ChatIcon, HomeIcon, SettingsIcon, ShieldIcon } from './icons.jsx';

const ITEMS = [
  { to: ROUTES.home, label: 'Home', Icon: HomeIcon },
  { to: ROUTES.settings, label: 'Settings', Icon: SettingsIcon },
  { to: ROUTES.about, label: 'About', Icon: ShieldIcon },
];

/**
 * Bottom navigation (thumb friendly on mobile, sticky on desktop).
 * The chat screen is reachable from Home, so it is not a separate tab.
 */
export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {ITEMS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} end={to === ROUTES.home} className="bottom-nav__item">
          <span className="bottom-nav__icon">
            <Icon />
          </span>
          {label}
        </NavLink>
      ))}
      <NavLink to={ROUTES.chat('girlfriend')} className="bottom-nav__item">
        <span className="bottom-nav__icon">
          <ChatIcon />
        </span>
        Chat
      </NavLink>
    </nav>
  );
}

export default BottomNav;
