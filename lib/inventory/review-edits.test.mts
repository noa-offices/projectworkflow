import assert from 'node:assert/strict';
import test from 'node:test';
import { initialStockInput, productInput } from './action-validation';
import { changedProductRequestFields } from './product-request-submission';

test('initial stock accepts only nonnegative integer live buckets and matching total', () => {
  assert.deepEqual(initialStockInput({warehouse:2,mockup:1},3), {warehouse:2,mockup:1});
  for (const value of [{sold:3},{warehouse:1.5},{warehouse:-1},{warehouse:'3'},[],null,{warehouse:2}]) {
    assert.throws(() => initialStockInput(value,3));
  }
});
test('review validation accepts request edits but excludes product state and identities', () => {
  assert.deepEqual(productInput({quantity:3,initial_stock:{mockup:3},source:'purchase',requested_status:'hold',is_active:false,id:'injected'},true,true,true),
    {quantity:3,initial_stock:{mockup:3},source:'purchase',requested_status:'hold'});
});
test('review sends only changed values including cost components', () => {
  const before = {quantity:3,item_name:'Chair',costs:{price:10,vat:1}};
  assert.deepEqual(changedProductRequestFields(before,{quantity:3,item_name:'Chair',costs:{price:12,vat:1}}),{costs:{price:12}});
});
