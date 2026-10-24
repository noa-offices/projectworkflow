import assert from 'node:assert/strict';
import test from 'node:test';
import { isActiveReservation, reservationTotals, canReleaseReservation } from './reservations';
const now = new Date('2026-10-24T00:00:00Z');
test('only active unexpired reservations reduce availability, including expiry boundary', () => {
 const reservations = [{status:'active',quantity:2,expires_at:null},{status:'active',quantity:3,expires_at:'2026-10-25T00:00:00Z'},{status:'active',quantity:4,expires_at:now.toISOString()},{status:'released',quantity:5,expires_at:null},{status:'fulfilled',quantity:6,expires_at:null}];
 assert.deepEqual(reservationTotals(12,reservations,now),{reserved_quantity:5,available_quantity:7});
 assert.equal(isActiveReservation(reservations[2],now),false);
});
test('only managers or the signed-in creator can release reservations', () => {
 assert.equal(canReleaseReservation('viewer','creator','creator'),true);
 assert.equal(canReleaseReservation('admin_manager','other','creator'),true);
 assert.equal(canReleaseReservation('system_owner','other','creator'),true);
 assert.equal(canReleaseReservation('designer','other','creator'),false);
 assert.equal(canReleaseReservation('viewer',null,null),false);
});
