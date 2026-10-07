import { runInNewContext } from 'node:vm';
import { signingKeyScript } from '../util/html';

interface FakeNode {
  textContent: string;
  children: FakeNode[];
  appendChild(child: FakeNode): void;
}

function fakeNode(textContent = ''): FakeNode {
  return {
    textContent,
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };
}

const fakeDocument = {
  createTextNode: (t: string) => fakeNode(t),
  createElement: () => fakeNode(),
};

interface SigningKeyUi {
  command(nonce: string, key: string | null): string;
  renderNote(el: FakeNode, key: string | null): void;
}

const ui = runInNewContext(`${signingKeyScript()}; SigningKeyUi`, {
  document: fakeDocument,
}) as SigningKeyUi;

function noteText(key: string | null): string {
  const el = fakeNode('stale');
  ui.renderNote(el, key);
  return el.children.map((c) => c.textContent).join('');
}

describe('btcli sign command', () => {
  it('leaves the wallet for btcli to prompt for when signing with the coldkey', () => {
    expect(ui.command('abc123', 'coldkey')).toBe("btcli wallet sign --message 'abc123'");
  });

  it('adds --use-hotkey when a hotkey is required', () => {
    expect(ui.command('abc123', 'hotkey')).toBe("btcli wallet sign --use-hotkey --message 'abc123'");
  });

  it('defaults to the coldkey when either key is accepted', () => {
    expect(ui.command('abc123', 'any')).toBe("btcli wallet sign --message 'abc123'");
  });

  it.each(['coldkey', 'hotkey', 'any'])('has no placeholders to replace (%s)', (key) => {
    expect(ui.command('n', key)).not.toMatch(/[<>]/);
  });

  it.each(['coldkey', 'hotkey', 'any'])('never emits the btcli 9-only --no-use-hotkey flag (%s)', (key) => {
    expect(ui.command('n', key)).not.toContain('--no-use-hotkey');
    expect(noteText(key)).not.toContain('--no-use-hotkey');
  });
});

describe('btcli sign note', () => {
  it('says btcli prompts for the wallet', () => {
    expect(noteText('coldkey')).toBe('Run this in your terminal. btcli asks which wallet to use.');
  });

  it('explains how to pick a hotkey other than default', () => {
    expect(noteText('hotkey')).toBe(
      'Run this in your terminal. btcli asks which wallet to use. ' +
        'If your hotkey is not named default, add -H <hotkey name>.',
    );
  });

  it('explains how to switch to a hotkey when either key is accepted', () => {
    expect(noteText('any')).toBe(
      'Run this in your terminal. btcli asks which wallet to use. ' +
        'It signs with the coldkey; to sign with a hotkey, add --use-hotkey, ' +
        'plus -H <hotkey name> if it is not named default.',
    );
  });

  it('replaces any previous note', () => {
    const el = fakeNode('stale');
    ui.renderNote(el, 'coldkey');
    expect(el.textContent).toBe('');
  });
});
