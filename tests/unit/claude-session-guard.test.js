const { test } = require('node:test');
const assert = require('node:assert');
const { updateClaudeSessionToken } = require('../../claude-session.js');

const ID_A = '11111111-2222-3333-4444-555555555555';
const ID_B = '99999999-8888-7777-6666-555555555555';

test('first token is captured', () => {
  const sess = { presetId: 'claude-code', sessionToken: undefined };
  assert.strictEqual(updateClaudeSessionToken(sess, ID_A, 'clideck01'), true);
  assert.strictEqual(sess.sessionToken, ID_A);
});

test('a different token does NOT replace an existing one', () => {
  const sess = { presetId: 'claude-code', sessionToken: ID_A };
  assert.strictEqual(updateClaudeSessionToken(sess, ID_B, 'clideck01'), false);
  assert.strictEqual(sess.sessionToken, ID_A);
});

test('options.replace=true allows replacement', () => {
  const sess = { presetId: 'claude-code', sessionToken: ID_A };
  assert.strictEqual(updateClaudeSessionToken(sess, ID_B, 'clideck01', { replace: true }), true);
  assert.strictEqual(sess.sessionToken, ID_B);
});
