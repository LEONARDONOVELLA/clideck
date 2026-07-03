const { test } = require('node:test');
const assert = require('node:assert');
const { isTyping } = require('../../timetracking.js');

test('real typing counts', () => {
  assert.strictEqual(isTyping('a'), true);
  assert.strictEqual(isTyping('hallo welt'), true);
  assert.strictEqual(isTyping('\r'), true);                    // Enter
  assert.strictEqual(isTyping('\x7f'), true);                  // Backspace
  assert.strictEqual(isTyping('\x1b[A'), true);                // arrow key = real interaction
  assert.strictEqual(isTyping('\x1b[200~paste\x1b[201~'), true); // bracketed paste
});

test('mouse scrolling does NOT count', () => {
  assert.strictEqual(isTyping('\x1b[<64;10;20M'), false);      // SGR wheel up
  assert.strictEqual(isTyping('\x1b[<65;10;20M'), false);      // SGR wheel down
  assert.strictEqual(isTyping('\x1b[<0;5;5M'), false);         // SGR click press
  assert.strictEqual(isTyping('\x1b[<0;5;5m'), false);         // SGR click release
  assert.strictEqual(isTyping('\x1b[Ma!!'), false);            // legacy X10 report
  // burst of several wheel events in one chunk
  assert.strictEqual(isTyping('\x1b[<64;1;1M\x1b[<64;1;2M\x1b[<65;1;3M'), false);
});

test('focus in/out reports do NOT count', () => {
  assert.strictEqual(isTyping('\x1b[I'), false);
  assert.strictEqual(isTyping('\x1b[O'), false);
});

test('empty/invalid input does not count', () => {
  assert.strictEqual(isTyping(''), false);
  assert.strictEqual(isTyping(undefined), false);
  assert.strictEqual(isTyping(null), false);
});
