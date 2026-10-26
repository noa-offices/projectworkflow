import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryNotificationTime, inventoryNotificationSender, inventoryNotificationPerson } from './notification-presentation';

test('only Inventory notifications use deterministic Dubai timestamps and safe full names',()=>{
  const item={order_no:'/inventory/requests?tab=products',created_at:'2026-10-26T21:30:00Z',sender_name:'Junais KP'};
  assert.equal(inventoryNotificationTime(item),'27 Oct 2026, 01:30');
  assert.equal(inventoryNotificationSender(item),'Junais KP');
  assert.equal(inventoryNotificationPerson(item,'Alex Morgan'),'Alex Morgan');
  assert.equal(inventoryNotificationPerson(item,'email@example.com'),'Team member');
  for(const name of [null,'','email@example.com']) assert.equal(inventoryNotificationSender({...item,sender_name:name}),'Team member');
  for(const path of [null,'ORD-1','/projects','/inventory-other']) {
    assert.equal(inventoryNotificationTime({...item,order_no:path}),null);
    assert.equal(inventoryNotificationSender({...item,order_no:path}),null);
  }
});
