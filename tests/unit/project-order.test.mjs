import { test } from 'node:test';
import assert from 'node:assert';
import { sortProjectsForDisplay, isSortEnabled } from '../../public/js/project-order.js';

const P = (name, extra = {}) => ({ id: name.toLowerCase(), name, ...extra });

test('sorts alphabetically, case-insensitive and numeric-aware', () => {
  const input = [P('zebra'), P('Alpha'), P('v10'), P('v2')];
  const out = sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(out.map(p => p.name), ['Alpha', 'v2', 'v10', 'zebra']);
});

test('sort disabled keeps config order', () => {
  const input = [P('zebra'), P('Alpha')];
  const out = sortProjectsForDisplay(input, { sortProjectsAlphabetically: false });
  assert.deepStrictEqual(out.map(p => p.name), ['zebra', 'Alpha']);
});

test('pinned projects come first, by pinOrder', () => {
  const input = [P('Alpha'), P('Mid', { pinned: true, pinOrder: 2 }), P('Zulu', { pinned: true, pinOrder: 1 })];
  const out = sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(out.map(p => p.name), ['Zulu', 'Mid', 'Alpha']);
});

test('pinned first even when sort disabled', () => {
  const input = [P('zebra'), P('pin', { pinned: true, pinOrder: 1 })];
  const out = sortProjectsForDisplay(input, { sortProjectsAlphabetically: false });
  assert.deepStrictEqual(out.map(p => p.name), ['pin', 'zebra']);
});

test('does not mutate the input array', () => {
  const input = [P('b'), P('a')];
  sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(input.map(p => p.name), ['b', 'a']);
});

test('isSortEnabled defaults to true', () => {
  assert.strictEqual(isSortEnabled({}), true);
  assert.strictEqual(isSortEnabled({ sortProjectsAlphabetically: false }), false);
});

test('newly pinned project (highest pinOrder) lands at the end of the pinned zone', () => {
  const input = [P('a', { pinned: true, pinOrder: 1 }), P('b', { pinned: true, pinOrder: 5 }), P('c')];
  const out = sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(out.map(p => p.name), ['a', 'b', 'c']);
});
