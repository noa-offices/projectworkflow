import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryPhotoContentType,inventoryPhotoError } from './photo-limits';
test('server byte inspection accepts all allowed signatures and refuses disguised or truncated files',()=>{
 assert.equal(inventoryPhotoContentType(new Uint8Array([255,216,255,224])),'image/jpeg');
 assert.equal(inventoryPhotoContentType(new Uint8Array([137,80,78,71,13,10,26,10])),'image/png');
 assert.equal(inventoryPhotoContentType(new Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80])),'image/webp');
 for(const bytes of [[],[255,216],[71,73,70,56,57,97],[60,115,118,103]]) assert.equal(inventoryPhotoContentType(new Uint8Array(bytes)),null);
});
test('size policy accepts the boundary and rejects oversized, empty and unsupported files',()=>{
 assert.equal(inventoryPhotoError(2097152,'image/webp'),null);
 assert.match(inventoryPhotoError(2097153,'image/jpeg')!,/2 MB/);
 for(const size of [0,-1,NaN,Infinity,'200',1.5]) assert.ok(inventoryPhotoError(size,'image/png'));
 assert.match(inventoryPhotoError(100,'image/gif')!,/JPEG|PNG|WebP/);
});
