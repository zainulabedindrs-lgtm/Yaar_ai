import { Component } from 'react';

/**
 * Last line of defence: if a component throws, the user sees a friendly card
 * with a reload action instead of a blank white screen.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the technical detail in the console for developers only.
    console.error('[yaar] render error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="container" style={{ paddingTop: '15vh' }}>
        <div className="limit-card" role="alert">
          <div className="limit-card__emoji" aria-hidden="true">
            🫤
          </div>
          <div className="limit-card__title">Something went wrong on this screen</div>
          <p className="limit-card__text">
            Your chats are safe. Reloading usually fixes it.
          </p>
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="button button--primary"
              onClick={() => window.location.reload()}
            >
              Reload Yaar
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
