import assert from 'node:assert/strict';
import test from 'node:test';
import * as presentation from './presentation';

test('identifier lines put Stock ref first and include only populated optional fields',()=>{
  const line=(presentation as unknown as {inventoryIdentifier:(value:object,unassigned?:boolean)=>string}).inventoryIdentifier;
  for(const [code,model,expected] of [
    [null,null,'IK1-0001'],['1234',null,'IK1-0001 · Code 1234'],[null,'X','IK1-0001 · Model X'],['1234','X','IK1-0001 · Code 1234 · Model X'],['  ','','IK1-0001'],
  ]) assert.equal(line({stock_ref:' IK1-0001 ',item_code:code,model_name:model}),expected);
  assert.equal(line({stock_ref:null,item_code:null,model_name:null},true),'Ref assigned on approval');
  assert.equal(line({stock_ref:null,item_code:'1234'},true),'Ref assigned on approval · Code 1234');
  assert.equal(line({stock_ref:null}),'');
  assert.equal(line({stock_ref:'GEN-0001'},true),'GEN-0001');
});
