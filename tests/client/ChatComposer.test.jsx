/**
 * The critical text-input requirements.
 *
 * The bug being guarded against: typing into the composer made words break in
 * the middle or parts of a word jump to another line. The fix is CSS
 * (`word-break: normal`, `overflow-wrap: normal`, `white-space: pre-wrap`,
 * `overflow-x: auto`, never `break-all`) plus behaviour: Enter sends, Shift+Enter
 * adds a line, and an IME composition never triggers a send.
 *
 * Both halves are tested here — behaviour through the DOM, and the CSS contract
 * by reading the stylesheet (jsdom's cascade cannot be trusted for that).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ChatComposer from '../../client/src/components/ChatComposer.jsx';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function renderComposer(props = {}) {
  const onSend = props.onSend ?? vi.fn();
  render(<ChatComposer onSend={onSend} {...props} />);
  return { onSend, input: screen.getByLabelText('Message') };
}

describe('ChatComposer — typing behaviour', () => {
  it('keeps short sentences exactly as typed', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();

    await user.type(input, 'Hey, how are you?');
    expect(input).toHaveValue('Hey, how are you?');
  });

  it('keeps a long sentence intact, with no word split or reordering', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    const sentence =
      'I had the longest day at work today and honestly I just wanted someone to talk to about it';

    await user.type(input, sentence);
    expect(input).toHaveValue(sentence);
  });

  it('keeps a very long single word intact', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    const longWord = 'pneumonoultramicroscopicsilicovolcanoconiosis';

    await user.type(input, longWord);
    expect(input).toHaveValue(longWord);
  });

  it('keeps Urdu text (right-to-left) intact', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    const urdu = 'آج میرا دن بہت لمبا تھا، تم سناؤ کیسا رہا؟';

    await user.type(input, urdu);
    expect(input).toHaveValue(urdu);
    expect(input).toHaveAttribute('dir', 'auto');
  });

  it('keeps Hindi (Devanagari) text intact', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    const hindi = 'आज मेरा दिन बहुत लंबा था, तुम सुनाओ कैसा रहा?';

    await user.type(input, hindi);
    expect(input).toHaveValue(hindi);
  });

  it('keeps mixed Urdu/English text intact', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();
    const mixed = 'I am so tired aaj, kal milte hain ٹھیک؟';

    await user.type(input, mixed);
    expect(input).toHaveValue(mixed);
  });

  it('accepts multi-line input through Shift+Enter without losing line breaks', async () => {
    const user = userEvent.setup();
    const { input } = renderComposer();

    await user.type(input, 'first line{Shift>}{Enter}{/Shift}second line');
    expect(input).toHaveValue('first line\nsecond line');
  });
});

describe('ChatComposer — sending', () => {
  it('sends on Enter for a desktop pointer and clears the field', async () => {
    const user = userEvent.setup();
    const { onSend, input } = renderComposer();

    await user.type(input, 'hello there{Enter}');
    expect(onSend).toHaveBeenCalledWith('hello there');
    expect(input).toHaveValue('');
  });

  it('does not send when the message is empty or only spaces', async () => {
    const user = userEvent.setup();
    const { onSend, input } = renderComposer();

    await user.type(input, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends via the send button', async () => {
    const user = userEvent.setup();
    const { onSend, input } = renderComposer();

    await user.type(input, 'button it is');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(onSend).toHaveBeenCalledWith('button it is');
  });

  it('never sends while an IME composition is in progress (Urdu/Hindi keyboards)', async () => {
    const user = userEvent.setup();
    const { onSend, input } = renderComposer();

    await user.type(input, 'kya haal');
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();

    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    // jsdom inserts a newline for the un-prevented Enter above (a real browser
    // commits the IME instead), so trim before comparing.
    expect(onSend.mock.calls[0][0].trim()).toBe('kya haal');
  });

  it('disables the send button when the daily limit is reached', async () => {
    const user = userEvent.setup();
    const { onSend, input } = renderComposer({ limitReached: true, canSend: false });

    await user.type(input, 'let me in');
    const button = screen.getByRole('button', { name: /send message/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a stop button instead of send while a reply is streaming', async () => {
    const onStop = vi.fn();
    renderComposer({ sending: true, onStop });

    const stopButton = screen.getByRole('button', { name: /stop the reply/i });
    expect(stopButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
  });

  it('shows the usage counter and the limit state on the hint row', () => {
    renderComposer({ counterText: '12 / 20', counterTone: 'low' });
    expect(screen.getByText('12 / 20')).toBeInTheDocument();
  });
});

describe('Composer CSS contract (no mid-word breaking)', () => {
  const rawCss = fs.readFileSync(path.join(repoRoot, 'client/src/styles/app.css'), 'utf8');
  // Comments are allowed to mention the forbidden properties while
  // explaining why they are forbidden, so strip them before checking.
  const css = stripCssComments(rawCss);
  const composerBlock = css.slice(css.indexOf('.composer__input'));

  it('never uses word-break: break-all anywhere in the stylesheet', () => {
    expect(css).not.toMatch(/word-break:\s*break-all/i);
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere/i);
  });

  it('uses normal word breaking with pre-wrap wrapping on the input', () => {
    expect(composerBlock).toMatch(/word-break:\s*normal/);
    expect(composerBlock).toMatch(/overflow-wrap:\s*normal/);
    expect(composerBlock).toMatch(/white-space:\s*pre-wrap/);
  });

  it('allows horizontal scrolling so an unbreakable word is never split', () => {
    expect(composerBlock).toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  it('keeps a 16px font size so mobile Safari does not zoom on focus', () => {
    expect(composerBlock).toMatch(/font-size:\s*16px/);
  });

  it('caps the auto-grown height so the composer cannot eat the screen', () => {
    expect(composerBlock).toMatch(/max-height:\s*\d+px/);
  });
});

// Strips CSS block comments from a stylesheet string.
// The delimiters are built from character codes because comment-like sequences
// get mangled by some editors/pipelines when embedded in source text.
function stripCssComments(source) {
  const open = String.fromCharCode(47, 42);
  const close = String.fromCharCode(42, 47);
  return source
    .split(open)
    .map((chunk, index) => (index === 0 ? chunk : chunk.slice(chunk.indexOf(close) + 2)))
    .join('');
}
