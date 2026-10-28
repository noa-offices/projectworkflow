import assert from 'node:assert/strict';
import test from 'node:test';
import { historyInput, historyCutoff, historyCount } from './request-history';

test('history validates scope and supported ages without accepting forged filters', () => {
  for (const kind of ['product','movement','all']) for (const olderThanDays of [0,30,90]) {
    assert.deepEqual(historyInput({kind,olderThanDays}),{kind,olderThanDays});
  }
  for (const input of [null,{}, {kind:'products',olderThanDays:0}, {kind:'all',olderThanDays:-1}, {kind:'all',olderThanDays:'30'}, {kind:'all',olderThanDays:1}]) assert.throws(()=>historyInput(input));
});
test('history cutoff is shared by count and clear and preserves all-time null', () => {
  assert.equal(historyCutoff(0,Date.parse('2026-10-28T12:00:00Z')),null);
  assert.equal(historyCutoff(30,Date.parse('2026-10-28T12:00:00Z')),'2026-09-28T12:00:00.000Z');
});
test('history sums validated table counts and rejects malformed RPC replies', () => {
  assert.equal(historyCount([{product_count:3,movement_count:2}]),5);
  for (const data of [null,[],[{product_count:-1,movement_count:2}],[{product_count:1.5,movement_count:2}]]) assert.throws(()=>historyCount(data));
});
