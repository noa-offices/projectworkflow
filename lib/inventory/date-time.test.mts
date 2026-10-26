import assert from 'node:assert/strict';
import test from 'node:test';
import * as presentation from './presentation';
import * as dates from './date-time';
const { formatInventoryDate } = presentation;

test('Inventory dates use Dubai time, including midnight and year rollover', () => {
  assert.equal(formatInventoryDate('2026-10-26T04:56:00Z'), '26 Oct 2026, 08:56');
  assert.equal(formatInventoryDate('2026-10-26T21:30:00Z'), '27 Oct 2026, 01:30');
  assert.equal(formatInventoryDate('2026-12-31T22:30:00Z'), '1 Jan 2027, 02:30');
  assert.equal(formatInventoryDate('2026-10-26T08:56:00+04:00'), '26 Oct 2026, 08:56');
});
test('Inventory invalid timestamps are safe and formatting ignores host timezone', () => {
  for (const value of ['', 'invalid', '2026-10-26T04:56:00']) assert.equal(formatInventoryDate(value), 'Unknown date');
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      assert.equal(formatInventoryDate('2026-10-26T04:56:00Z'), '26 Oct 2026, 08:56');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('people show only full names with a safe fallback', () => {
  const inventoryPersonName = (presentation as Record<string, unknown>).inventoryPersonName as (value?: string | null) => string;
  assert.equal(inventoryPersonName('  Junais KP  '), 'Junais KP');
  for (const value of [null, undefined, '', '   ', 'person@example.com', 'Unknown']) assert.equal(inventoryPersonName(value), 'Team member');
});
test('Dubai input and day boundaries ignore the device timezone', () => {
  assert.equal(dates.dubaiLocalToIso('2026-10-27T01:30'), '2026-10-26T21:30:00.000Z');
  assert.deepEqual(dates.dubaiDayBounds('2026-10-26','2026-10-26'), {from:'2026-10-25T20:00:00.000Z',to:'2026-10-26T19:59:59.999Z'});
  for (const value of ['invalid','2026-02-30T12:00','2026-10-26T25:30','2026-10-26T24:00']) assert.throws(()=>dates.dubaiLocalToIso(value), /valid Dubai/);
});
