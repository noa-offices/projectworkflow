import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteConfirmationMatches,deletedProductHref,deletedProductMessage} from './delete-product';
test('deletion needs the exact nonempty Stock ref and carries cleanup warnings to Products',()=>{
 assert.equal(deleteConfirmationMatches('GEN-0001','GEN-0001'),true);
 for(const value of ['gen-0001','GEN-0001 ','','wrong']) assert.equal(deleteConfirmationMatches(value,'GEN-0001'),false);
 assert.equal(deleteConfirmationMatches('',''),false);
 assert.equal(deletedProductHref(0),'/inventory/products?deleted=1');
 assert.equal(deletedProductHref(2),'/inventory/products?deleted=1&photoCleanup=2');
 assert.equal(deletedProductMessage(2),'Item deleted, 2 photos could not be removed.');
});
