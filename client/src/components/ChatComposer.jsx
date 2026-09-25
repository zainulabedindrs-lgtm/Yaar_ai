import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_MESSAGE_LENGTH } from '@shared/errors';

import { useIsTouchDevice } from '../hooks/useIsTouchDevice.js';
import { SendIcon, StopIcon } from './icons.jsx';

/** Keep these two in sync with `.composer__input` in app.css. */
const MAX_INPUT_HEIGHT = 132;
const MIN_INPUT_HEIGHT = 26;

/**
 * The message composer.
 *
 * CRITICAL TEXT INPUT REQUIREMENTS (see README → "Composer word wrapping"):
 *  - words are never split in the middle while typing (`word-break: normal`,
 *    `overflow-wrap: normal` in CSS — never `break-all`)
 *  - wrapping happens at real word boundaries (`white-space: pre-wrap`)
 *  - an exceptionally long word scrolls horizontally inside the field instead
 *    of breaking, so English/Urdu/Hindi/mixed text all stay readable
 *  - the field auto-grows to ~5 lines and then scrolls vertically
 *  - Enter sends on desktop, Shift+Enter adds a line; on touch devices Enter
 *    adds a line and the send button sends
 *  - IME composition (Urdu/Hindi keyboards) never triggers an accidental send
 *  - `dir="auto"` so Urdu/Hindi text renders right-to-left correctly
 *
 * @param {Object} props
 * @param {(text: string) => void} props.onSend
 * @param {() => void} [props.onStop]
 * @param {boolean} [props.sending]
 * @param {boolean} [props.canSend]
 * @param {boolean} [props.limitReached]
 * @param {boolean} [props.disabled]
 * @param {string} [props.hint]
 * @param {string} [props.counterText]
 * @param {string} [props.counterTone]   '', 'low' | 'out'
 * @param {string} [props.placeholder]
 */
export function ChatComposer({
  onSend,
  onStop,
  sending = false,
  canSend = true,
  limitReached = false,
  disabled = false,
  hint = '',
  counterText = '',
  counterTone = '',
  placeholder = 'Message…',
}) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(/** @type {HTMLTextAreaElement|null} */ (null));
  const composingRef = useRef(false);
  const isTouch = useIsTouchDevice();

  /** Grows the field with the content, capped at MAX_INPUT_HEIGHT. */
  const resize = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    const next = Math.min(Math.max(element.scrollHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT);
    element.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  // Re-measure when the layout width changes (rotation, split screen, desktop
  // resize): wrapping changes the needed height.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => resize());
    observer.observe(element);
    return () => observer.disconnect();
  }, [resize]);

  const trimmed = value.trim();
  const sendDisabled = disabled || !canSend || trimmed.length === 0;

  const submit = useCallback(() => {
    if (sendDisabled) return;
    const text = value;
    // Clear immediately: the optimistic bubble in the chat is the source of
    // truth from this point on, and a failure keeps the text in that bubble
    // with a retry action.
    setValue('');
    onSend?.(text);
    requestAnimationFrame(() => {
      resize();
      textareaRef.current?.focus();
    });
  }, [onSend, resize, sendDisabled, value]);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter') return;
      // Never intercept Enter while an IME is composing (Urdu/Hindi keyboards).
      if (composingRef.current || event.nativeEvent?.isComposing) return;
      if (event.shiftKey) return; // newline
      if (isTouch) return; // touch keyboards use the send button
      event.preventDefault();
      submit();
    },
    [isTouch, submit],
  );

  return (
    <div className="composer">
      <div className="composer__inner">
        <div className="composer__field">
          <textarea
            ref={textareaRef}
            className="composer__input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onFocus={() => requestAnimationFrame(resize)}
            placeholder={limitReached ? 'Come back after 24 hours 💛' : placeholder}
            rows={1}
            dir="auto"
            name="message"
            aria-label="Message"
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck="true"
            enterKeyHint={isTouch ? 'enter' : 'send'}
            maxLength={MAX_MESSAGE_LENGTH}
            disabled={disabled}
          />
        </div>

        {sending && onStop ? (
          <button
            type="button"
            className="composer__send"
            onClick={onStop}
            aria-label="Stop the reply"
            title="Stop the reply"
            style={{ backgroundImage: 'none', background: 'var(--surface-soft)', color: 'var(--text-soft)' }}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="composer__send"
            onClick={submit}
            disabled={sendDisabled}
            aria-label="Send message"
            title="Send message"
          >
            <SendIcon />
          </button>
        )}
      </div>

      <div className="composer__hint" aria-live="polite">
        <span>
          {limitReached
            ? 'Daily limit reached'
            : hint || (isTouch ? 'Tap send when you are ready' : 'Enter to send · Shift + Enter for a new line')}
        </span>
        {counterText ? (
          <span className={`composer__counter${counterTone ? ` composer__counter--${counterTone}` : ''}`}>
            {counterText}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default ChatComposer;
