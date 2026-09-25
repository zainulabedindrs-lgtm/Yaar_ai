import { Outlet } from 'react-router-dom';

import BottomNav from './BottomNav.jsx';
import ConnectionBar from './ConnectionBar.jsx';

/**
 * App chrome: a full-height column with the page in the middle and the bottom
 * navigation pinned. The chat screen opts out of the bottom nav (it owns the
 * full height, including the composer) via `hideNav` in the route element.
 *
 * @param {{ hideNav?: boolean }} props
 */
export function AppShell({ hideNav = false }) {
  return (
    <div className={`app-shell ${hideNav ? '' : 'app-shell--chrome'}`.trim()}>
      <ConnectionBar />
      <main className="app-shell__main">
        <Outlet />
      </main>
      {hideNav ? null : <BottomNav />}
    </div>
  );
}

export default AppShell;
