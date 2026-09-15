/**
 * UI states a user actually reads: the usage meter, the "that's all 20 messages"
 * card, the friendly error banner and the confirmation dialog.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ConfirmDialog from '../../client/src/components/ConfirmDialog.jsx';
import ErrorBanner from '../../client/src/components/ErrorBanner.jsx';
import LimitNotice from '../../client/src/components/LimitNotice.jsx';
import UsageMeter from '../../client/src/components/UsageMeter.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../client/src/components/States.jsx';

const HOUR = 60 * 60 * 1000;

describe('UsageMeter', () => {
  it('shows "12 / 20 messages used" with a progress bar', () => {
    render(
      <UsageMeter
        usage={{
          used: 12,
          limit: 20,
          remaining: 8,
          resetAt: Date.now() + 5 * HOUR,
          exhausted: false,
        }}
      />,
    );

    expect(screen.getByText('12 / 20 messages used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '20');
    expect(screen.getByText(/8 left/)).toBeInTheDocument();
  });

  it('counts the reset down once the allowance is spent', () => {
    render(
      <UsageMeter
        usage={{
          used: 20,
          limit: 20,
          remaining: 0,
          resetAt: Date.now() + 4 * HOUR + 12 * 60 * 1000,
          exhausted: true,
        }}
      />,
    );

    expect(screen.getByText('20 / 20 messages used')).toBeInTheDocument();
    expect(screen.getByText(/Resets in 4h 1[12]m/)).toBeInTheDocument();
  });

  it('renders a skeleton before the usage has loaded', () => {
    const { container } = render(<UsageMeter usage={null} />);
    expect(container.querySelector('.skeleton')).toBeTruthy();
  });
});

describe('LimitNotice', () => {
  it('shows the friendly 20-message message, the reset time and the promise that nothing was lost', () => {
    render(<LimitNotice resetAt={Date.now() + 3 * HOUR} limit={20} />);

    expect(screen.getByText(/That's all 20 messages for now/)).toBeInTheDocument();
    expect(screen.getByText(/Come back after 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is lost/i)).toBeInTheDocument();
    expect(screen.getByText(/Free again in 2h 59m|Free again in 3h/)).toBeInTheDocument();
  });
});

describe('ErrorBanner', () => {
  it('shows the server message with retry and dismiss actions', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDismiss = vi.fn();

    render(
      <ErrorBanner
        error={{ code: 'ai_unavailable', message: "I couldn't reply just now." }}
        onRetry={onRetry}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent("I couldn't reply just now.");
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('uses friendly copy for an offline device', () => {
    render(<ErrorBanner error={null} offline />);
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('never renders a raw error code at the user', () => {
    render(<ErrorBanner error={{ code: 'ai_timeout' }} />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('ai_timeout');
    expect(screen.getByRole('alert')).toHaveTextContent(/took too long/i);
  });

  it('renders nothing when there is no error', () => {
    const { container } = render(<ErrorBanner error={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ConfirmDialog', () => {
  it('asks before a destructive action and runs it only on confirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Clear chat?"
        text="This cannot be undone."
        confirmLabel="Clear chat"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Clear chat?');
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Clear chat' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Sure?" text="Really?" onConfirm={() => {}} onCancel={onCancel} />);

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    const { container } = render(
      <ConfirmDialog open={false} title="x" text="y" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('shared states', () => {
  it('LoadingState announces itself to assistive tech', () => {
    render(<LoadingState label="Loading your chats…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your chats…');
  });

  it('EmptyState shows a friendly prompt', () => {
    render(<EmptyState emoji="👋" title="Say hi to Ayesha" description="Type anything." />);
    expect(screen.getByText('Say hi to Ayesha')).toBeInTheDocument();
    expect(screen.getByText('Type anything.')).toBeInTheDocument();
  });

  it('ErrorState offers a retry without exposing internals', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState error={{ code: 'server_error' }} onRetry={onRetry} />);

    expect(screen.getByRole('alert')).not.toHaveTextContent('server_error');
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
