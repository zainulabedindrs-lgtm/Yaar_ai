import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { WifiOffIcon } from './icons.jsx';

/** Shown while the device is offline so sends are never a silent failure. */
export function ConnectionBar() {
  const online = useOnlineStatus();
  if (online) return null;

  return (
    <div className="connection-bar" role="status">
      <WifiOffIcon style={{ verticalAlign: '-3px', marginRight: 6 }} />
      You are offline — messages will send when you are back.
    </div>
  );
}

export default ConnectionBar;
