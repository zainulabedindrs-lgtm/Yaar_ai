import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ERROR_CODES } from '@shared/errors';

import { ApiClientError } from '../api/httpClient.js';
import { regenerateStream, sendMessageStream } from '../api/chatStream.js';
import { yaarApi } from '../api/yaarApi.js';
import { useSession } from './useSession.jsx';

/**
 * Chat state machine for one companion.
 *
 * Message lifecycle:
 *   optimistic user bubble ('sending') → confirmed by the server ('sent')
 *   → AI placeholder bubble ('streaming') → filled by deltas → 'sent'
 *
 * A failure never loses the user's text: the bubble stays on screen marked
 * "not delivered" with a retry action, and the server refunds the usage credit
 * when no reply was produced.
 */

/** Maps an API message row to the UI shape. */
function fromServer(row) {
  return {
    id: row.id,
    sender: row.sender,
    content: row.content,
    createdAt: row.createdAt,
    seq: row.seq,
    status: row.status === 'failed' ? 'failed' : 'sent',
    errorCode: row.errorCode ?? null,
  };
}

/** Ids come from the client so a retry can be idempotent server-side. */
function newId() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Streaming bubbles sort after everything that came from the database.
const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

/**
 * @param {string} companionId
 */
export function useChat(companionId) {
  const { setUsage, usage: sessionUsage } = useSession();

  const [messages, setMessages] = useState([]);
  const [usage, setLocalUsage] = useState(sessionUsage);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(/** @type {ApiClientError|null} */ (null));
  const [loadError, setLoadError] = useState(/** @type {ApiClientError|null} */ (null));

  const abortRef = useRef(/** @type {AbortController|null} */ (null));
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const applyUsage = useCallback(
    (nextUsage) => {
      if (!nextUsage) return;
      setLocalUsage(nextUsage);
      setUsage(nextUsage);
    },
    [setUsage],
  );

  // --- history -------------------------------------------------------------
  const loadHistory = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await yaarApi.getMessages(companionId);
      if (!mounted.current) return;
      setMessages(payload.messages.map(fromServer));
      applyUsage(payload.usage);
    } catch (caught) {
      if (!mounted.current) return;
      setLoadError(
        caught instanceof ApiClientError ? caught : new ApiClientError(ERROR_CODES.SERVER),
      );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [companionId, applyUsage]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setLocalUsage(sessionUsage);
  }, [sessionUsage]);

  const limitReached = Boolean(usage?.exhausted);
  const lastMessage = messages[messages.length - 1] ?? null;
  /** The conversation ends with a user message and no reply arrived yet. */
  const awaitingReply = Boolean(lastMessage && lastMessage.sender === 'user' && !sending);

  const patchMessage = useCallback((id, patch) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  }, []);

  /**
   * Runs one streaming turn and keeps the message list in sync with it.
   * Used by `send`, `retry` and `regenerate`.
   *
   * @param {Object} params
   * @param {(handlers: Object) => Promise<void>} params.transport
   * @param {string} [params.clientMessageId] optimistic user bubble id
   */
  const runTurn = useCallback(
    async ({ transport, clientMessageId }) => {
      if (sendingRef.current) return;
      sendingRef.current = true;

      const assistantId = newId();
      const controller = new AbortController();
      abortRef.current = controller;
      setSending(true);
      setError(null);

      let assistantAdded = false;
      const ensureAssistantBubble = () => {
        if (assistantAdded || !mounted.current) return;
        assistantAdded = true;
        setMessages((current) => [
          ...current,
          {
            id: assistantId,
            sender: 'assistant',
            content: '',
            createdAt: Date.now(),
            seq: PENDING_SEQ,
            status: 'streaming',
          },
        ]);
      };

      const dropEmptyAssistant = () => {
        setMessages((current) =>
          current.filter((message) => !(message.id === assistantId && !message.content)),
        );
      };

      try {
        await transport({
          signal: controller.signal,
          onMeta: (payload) => {
            if (!mounted.current) return;
            if (payload?.userMessage) {
              const serverMessage = fromServer(payload.userMessage);
              setMessages((current) => {
                const index = current.findIndex((message) => message.id === serverMessage.id);
                if (index === -1) return [...current, serverMessage];
                const copy = [...current];
                copy[index] = serverMessage;
                return copy;
              });
            }
            applyUsage(payload?.usage);
            ensureAssistantBubble();
          },
          onDelta: (delta) => {
            if (!mounted.current) return;
            ensureAssistantBubble();
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + delta, status: 'streaming' }
                  : message,
              ),
            );
          },
          onDone: (payload) => {
            if (!mounted.current) return;
            ensureAssistantBubble();
            const serverMessage = payload?.assistantMessage
              ? fromServer(payload.assistantMessage)
              : null;
            setMessages((current) => {
              const index = current.findIndex((message) => message.id === assistantId);
              if (!serverMessage) {
                if (index === -1) return current;
                const copy = [...current];
                copy[index] = { ...copy[index], status: 'sent' };
                return copy;
              }
              if (index === -1) return [...current, serverMessage];
              const copy = [...current];
              copy[index] = serverMessage;
              return copy;
            });
            applyUsage(payload?.usage);
          },
          onError: (apiError) => {
            if (!mounted.current) return;
            if (apiError.code === ERROR_CODES.CANCELLED) {
              // The user stopped the reply, or navigated away.
              dropEmptyAssistant();
              return;
            }
            dropEmptyAssistant();
            setError(apiError);
            if (clientMessageId) {
              setMessages((current) =>
                current.map((message) =>
                  message.id === clientMessageId && message.status !== 'sent'
                    ? { ...message, status: 'failed', errorCode: apiError.code }
                    : message,
                ),
              );
            }
          },
        });
      } finally {
        sendingRef.current = false;
        if (mounted.current) setSending(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [applyUsage],
  );

  // --- send ---------------------------------------------------------------
  const send = useCallback(
    async (rawText) => {
      const content = String(rawText ?? '').trim();
      if (!content) {
        setError(new ApiClientError(ERROR_CODES.EMPTY_MESSAGE));
        return false;
      }
      if (limitReached) {
        setError(new ApiClientError(ERROR_CODES.LIMIT_REACHED));
        return false;
      }
      if (sendingRef.current) return false;

      const clientMessageId = newId();
      setMessages((current) => [
        ...current,
        {
          id: clientMessageId,
          sender: 'user',
          content,
          createdAt: Date.now(),
          seq: PENDING_SEQ,
          status: 'sending',
        },
      ]);

      await runTurn({
        clientMessageId,
        transport: (handlers) =>
          sendMessageStream({ companionId, content, clientMessageId, ...handlers }),
      });
      return true;
    },
    [companionId, limitReached, runTurn],
  );

  /**
   * Retries the turn that failed. The repeated `clientMessageId` tells the
   * server it is the same message, so a retry can never consume a second credit
   * from the daily allowance.
   */
  const retry = useCallback(async () => {
    const failed = [...messagesRef.current]
      .reverse()
      .find((message) => message.sender === 'user' && message.status === 'failed');
    if (!failed || sendingRef.current) return;

    patchMessage(failed.id, { status: 'sending', errorCode: null });
    await runTurn({
      clientMessageId: failed.id,
      transport: (handlers) =>
        sendMessageStream({
          companionId,
          content: failed.content,
          clientMessageId: failed.id,
          ...handlers,
        }),
    });
  }, [companionId, patchMessage, runTurn]);

  /** Asks for another reply when the AI produced nothing (no credit used). */
  const regenerate = useCallback(async () => {
    if (sendingRef.current) return;
    await runTurn({
      transport: (handlers) => regenerateStream({ companionId, ...handlers }),
    });
  }, [companionId, runTurn]);

  /** Stops an in-flight reply; the server returns the credit. */
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearConversation = useCallback(async () => {
    const payload = await yaarApi.clearMessages(companionId);
    if (!mounted.current) return;
    setMessages(payload.messages.map(fromServer));
  }, [companionId]);

  const dismissError = useCallback(() => setError(null), []);

  const canSend = useMemo(() => !sending && !limitReached, [sending, limitReached]);

  // Messages are ordered by sequence; pending bubbles sort last.
  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => (a.seq ?? PENDING_SEQ) - (b.seq ?? PENDING_SEQ)),
    [messages],
  );

  return {
    messages: orderedMessages,
    usage,
    loading,
    sending,
    error,
    loadError,
    limitReached,
    awaitingReply,
    canSend,
    send,
    retry,
    regenerate,
    stop,
    reload: loadHistory,
    clearConversation,
    dismissError,
  };
}
