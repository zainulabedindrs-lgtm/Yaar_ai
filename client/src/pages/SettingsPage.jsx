import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { LAST_COMPANION_STORAGE_KEY } from '@shared/errors';

import Avatar from '../components/Avatar.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { ErrorState, LoadingState } from '../components/States.jsx';
import UsageMeter from '../components/UsageMeter.jsx';
import { ChevronRightIcon, TrashIcon } from '../components/icons.jsx';
import { yaarApi } from '../api/yaarApi.js';
import { ROUTES } from '../config/appConfig.js';
import { useSession } from '../hooks/useSession.jsx';
import { formatDuration } from '../utils/format.js';
import { readStorage } from '../utils/storage.js';

/**
 * Settings / profile.
 *
 * Contains: the selected companion (and a switch), language behaviour, chat
 * usage, privacy summary, session information, clear-conversation and
 * delete-my-data actions (both behind a confirmation), app version and links.
 */
export function SettingsPage() {
  const navigate = useNavigate();
  const {
    status,
    error,
    reload,
    companions,
    usage,
    conversations,
    user,
    ai,
    app,
    deleteAccount,
  } = useSession();

  const [dialog, setDialog] = useState(/** @type {null|'clear'|'delete'} */ (null));
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState('');

  if (status === 'loading') {
    return (
      <div className="container">
        <LoadingState label="Loading your settings…" />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        <ErrorState error={error} onRetry={() => reload()} />
      </div>
    );
  }

  const selectedId = readStorage(LAST_COMPANION_STORAGE_KEY, 'girlfriend');
  const selected = companions.find((companion) => companion.id === selectedId) ?? companions[0];
  const selectedConversation = conversations.find(
    (conversation) => conversation.companionId === selected?.id,
  );

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setActionError(null);
  };

  const handleClear = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await yaarApi.clearMessages(selected.id);
      setNotice(`Cleared your ${selected.displayName} conversation.`);
      await reload({ silent: true });
      setDialog(null);
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteAccount();
      setDialog(null);
      navigate(ROUTES.home, { replace: true });
      window.location.reload();
    } catch (caught) {
      setActionError(caught);
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="page fade-rise">
        <div className="page__header">
          <h1 className="page__title">Settings</h1>
          <p className="page__lead">Everything about your Yaar experience, in one place.</p>
        </div>

        {notice ? (
          <div className="banner banner--info" role="status">
            {notice}
          </div>
        ) : null}
        {actionError ? <ErrorBanner error={actionError} onDismiss={() => setActionError(null)} /> : null}

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <h2 className="section__title">Your companion</h2>
          <div className="section__body">
            <div className="setting-row">
              <Avatar companion={selected} size="md" presence />
              <div className="setting-row__body">
                <div className="setting-row__label">
                  {selected?.label} · {selected?.displayName}
                </div>
                <div className="setting-row__value">
                  {selectedConversation
                    ? `${selectedConversation.messageCount} messages saved`
                    : 'No messages yet'}
                </div>
              </div>
              <button
                type="button"
                className="button button--sm button--soft"
                onClick={() => navigate(ROUTES.chat(selected?.id ?? 'girlfriend'))}
              >
                Open chat
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">Switch companion</div>
                <div className="setting-row__value">
                  Each companion keeps their own separate conversation.
                </div>
              </div>
              <div className="setting-row__control">
                {companions.map((companion) => (
                  <button
                    key={companion.id}
                    type="button"
                    className={`button button--sm ${
                      companion.id === selected?.id ? 'button--primary' : 'button--ghost'
                    }`}
                    onClick={() => navigate(ROUTES.chat(companion.id))}
                  >
                    {companion.displayName}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <h2 className="section__title">Chat usage</h2>
          <div className="section__body">
            <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <UsageMeter usage={usage} />
            </div>
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">Free messages every 24 hours</div>
                <div className="setting-row__value">
                  {usage?.limit ?? app?.dailyMessageLimit ?? 20} messages. Only your messages count —
                  replies are always free.
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">Next reset</div>
                <div className="setting-row__value">
                  {usage
                    ? `${new Date(usage.resetAt).toLocaleString()} (in ${formatDuration(
                        usage.resetAt - Date.now(),
                      )})`
                    : '—'}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <h2 className="section__title">Language</h2>
          <div className="section__body">
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">Automatic — nothing to choose</div>
                <div className="setting-row__value">
                  Yaar replies in whatever language you write in: English, اردو, हिन्दी, Roman
                  Urdu/Hindi, or a natural mix of them. Switch languages mid-chat and the replies
                  follow you.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <h2 className="section__title">Privacy &amp; data</h2>
          <div className="section__body">
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">Your session</div>
                <div className="setting-row__value">
                  Anonymous ID {user?.ref ?? '—'} · created{' '}
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">Where your words go</div>
                <div className="setting-row__value">
                  Messages are stored on the Yaar server for your session and sent to the AI provider
                  ({ai?.label ?? 'Hugging Face'}) to generate replies. They are never shown to other
                  users. See the <a href={ROUTES.privacy}>privacy page</a>.
                </div>
              </div>
              <div className="setting-row__control">
                <a className="icon-button" href={ROUTES.privacy} aria-label="Privacy details">
                  <ChevronRightIcon width={18} height={18} />
                </a>
              </div>
            </div>
            {selectedConversation ? (
              <button type="button" className="setting-row setting-row--action" onClick={() => setDialog('clear')}>
                <div className="setting-row__body">
                  <div className="setting-row__label">Clear conversation with {selected.displayName}</div>
                  <div className="setting-row__value">
                    Deletes {selectedConversation.messageCount} saved messages. Your usage counter is
                    not affected.
                  </div>
                </div>
                <div className="setting-row__control">
                  <TrashIcon width={18} height={18} />
                </div>
              </button>
            ) : null}
            <button
              type="button"
              className="setting-row setting-row--action"
              onClick={() => setDialog('delete')}
            >
              <div className="setting-row__body">
                <div className="setting-row__label">Delete all my data</div>
                <div className="setting-row__value">
                  Removes every message, conversation and usage record for this session.
                </div>
              </div>
              <div className="setting-row__control">
                <TrashIcon width={18} height={18} />
              </div>
            </button>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        <section className="section">
          <h2 className="section__title">About</h2>
          <div className="section__body">
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">App version</div>
                <div className="setting-row__value">
                  {app?.name ?? 'Yaar'} v{app?.version ?? '1.0.0'}
                </div>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-row__body">
                <div className="setting-row__label">AI model</div>
                <div className="setting-row__value">
                  {ai?.model ?? 'not configured'}
                  {ai?.configured === false ? ' — add HF_API_KEY on the server' : ''}
                </div>
              </div>
            </div>
            <LinkRow to={ROUTES.about} label="About Yaar" />
            <LinkRow to={ROUTES.terms} label="Terms of use" />
            <LinkRow to={ROUTES.privacy} label="Privacy policy" />
          </div>
        </section>

        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>
          Made with care 💛 Yaar is an AI companion, not a human.
        </p>
      </div>

      <ConfirmDialog
        open={dialog === 'clear'}
        title={`Clear chat with ${selected?.displayName ?? 'your Yaar'}?`}
        text="This deletes the saved messages in this conversation. It cannot be undone, and your daily message counter stays as it is."
        confirmLabel="Clear chat"
        onConfirm={handleClear}
        onCancel={closeDialog}
        busy={busy}
      />

      <ConfirmDialog
        open={dialog === 'delete'}
        title="Delete all your data?"
        text="Every message, conversation and usage record for this session will be permanently removed. You will start fresh with a new anonymous session."
        confirmLabel="Delete everything"
        onConfirm={handleDelete}
        onCancel={closeDialog}
        busy={busy}
      />
    </div>
  );
}

/** Small navigation row used in the About section. */
function LinkRow({ to, label }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="setting-row setting-row--action" onClick={() => navigate(to)}>
      <div className="setting-row__body">
        <div className="setting-row__label">{label}</div>
      </div>
      <div className="setting-row__control">
        <ChevronRightIcon width={18} height={18} />
      </div>
    </button>
  );
}

export default SettingsPage;
