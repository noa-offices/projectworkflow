import assert from 'node:assert/strict';
import test from 'node:test';
import { availableLocations, movementRequestPayload, movementSubmitLabel, parseRequestParams, requestButtons, reviewRequestPayload } from './request-presentation';
import { previewProduct } from './preview-data';

test('manager movement buttons apply immediately while requester labels stay unchanged', () => {
  for (const role of ['system_owner', 'admin_manager']) {
    assert.equal(movementSubmitLabel(role, 'take'), 'Take now');
    assert.equal(movementSubmitLabel(role, 'move'), 'Move now');
    assert.equal(movementSubmitLabel(role, 'hold'), 'Hold now');
    assert.equal(movementSubmitLabel(role, 'book', true), 'Book now');
  }
  for (const role of ['warehouse_staff', 'designer', null]) {
    assert.equal(movementSubmitLabel(role, 'take'), 'Send request');
    assert.equal(movementSubmitLabel(role, 'hold', true), 'Send sample request');
  }
});

test('request buttons match all eight roles and unknown roles', () => {
  for (const role of ['system_owner', 'admin_manager']) assert.deepEqual(requestButtons(role), { add: true, takeMove: true, holdBook: true, review: true });
  assert.deepEqual(requestButtons('warehouse_staff'), { add: true, takeMove: true, holdBook: false, review: false });
  for (const role of ['procurement_manager','sales_designer','sales_coordinator','designer']) assert.deepEqual(requestButtons(role), { add: false, takeMove: false, holdBook: true, review: false });
  for (const role of ['viewer', 'unknown', null]) assert.deepEqual(requestButtons(role), { add: false, takeMove: false, holdBook: false, review: false });
});
test('request params have role defaults and validate tab, status, mine and pagination', () => {
  assert.deepEqual(parseRequestParams({}, true), { tab: 'products', status: 'pending_review', mine: false, page: 1 });
  assert.equal(parseRequestParams({}, false).status, 'all');
  assert.deepEqual(parseRequestParams({ tab: ['movements','products'], status: 'approved', mine: '1', page: '3' }, false), { tab: 'movements', status: 'approved', mine: true, page: 3 });
  assert.deepEqual(parseRequestParams({ tab: 'invalid', status: 'invalid', page: '1.5' }, false), { tab: 'products', status: 'all', mine: false, page: 1 });
  for (const page of ['0','-2','Infinity','1000001']) assert.equal(parseRequestParams({page}, false).page, 1);
});
test('take uses sale to sold, move uses live locations and checks source availability', () => {
  assert.equal(availableLocations(previewProduct).length, 5);
  assert.equal(availableLocations(previewProduct)[0].available, 12);
  const take = movementRequestPayload(previewProduct, { kind: 'take', quantity: '2', from: 'warehouse', to: '', note: ' Test ' });
  assert.equal(take.actionType, 'sale'); assert.equal(take.toLocation, 'sold'); assert.equal(take.note, 'Test');
  assert.equal(movementRequestPayload(previewProduct, {kind:'move',quantity:'2',from:'warehouse',to:'dubai_showroom',note:''}).actionType,'internal_transfer');
  for (const quantity of ['0','-1','1.5','','13','1e1']) assert.throws(() => movementRequestPayload(previewProduct,{kind:'take',quantity,from:'warehouse',to:'',note:''}));
  assert.throws(() => movementRequestPayload(previewProduct,{kind:'move',quantity:'1',from:'warehouse',to:'warehouse',note:''}), /different/);
  assert.throws(() => movementRequestPayload(previewProduct,{kind:'move',quantity:'1',from:'warehouse',to:'sold',note:''}));
  assert.throws(() => movementRequestPayload({...previewProduct,is_active:false},{kind:'take',quantity:'1',from:'warehouse',to:'',note:''}), /removed/);
});
test('hold and book normalize to the existing default without a stock limit', () => {
  for (const kind of ['hold','book'] as const) {
    const payload = movementRequestPayload(previewProduct,{kind,quantity:'99',from:'',to:'',note:''});
    assert.equal(payload.actionType, 'internal_transfer'); assert.equal(payload.fromLocation, null); assert.equal(payload.toLocation, null);
  }
});
test('review requires a rejection note and preserves the existing input contract', () => {
  assert.throws(() => reviewRequestPayload(previewProduct.id,'rejected','  '), /required/);
  assert.throws(() => reviewRequestPayload(previewProduct.id,'approved','x'.repeat(2001)));
  assert.deepEqual(reviewRequestPayload(previewProduct.id,'rejected',' No stock '), { requestId:previewProduct.id, decision:'rejected',reviewNote:'No stock' });
});
