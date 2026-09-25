import { useNavigate } from 'react-router-dom';

import { EmptyState } from '../components/States.jsx';
import { ROUTES } from '../config/appConfig.js';

/** 404 — always offers a way back, never a dead end. */
export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="container" style={{ paddingTop: '12vh' }}>
      <EmptyState
        emoji="🧭"
        title="This page took a wrong turn"
        description="The screen you were looking for does not exist."
      />
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <button type="button" className="button button--primary" onClick={() => navigate(ROUTES.home)}>
          Back to home
        </button>
      </div>
    </div>
  );
}

export default NotFoundPage;
