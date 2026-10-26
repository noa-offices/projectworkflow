import test from 'node:test';
import assert from 'node:assert/strict';
import { fitInventoryPhoto, photoSizeLabel } from './photo-compress';
const blob=(size:number,type='image/webp')=>new Blob([new Uint8Array(size)],{type});
test('quality lowers at 2000px before dimensions shrink, keeping aspect and accepting 2 MiB',async()=>{
 const calls:{width:number;height:number;quality:number;type:string}[]=[];
 const result=await fitInventoryPhoto(4000,2000,async(width,height,type,quality)=>{
  calls.push({width,height,type,quality});return blob(quality>.7?2200000:2097152,type);
 });
 assert.equal(result.size,2097152);assert.equal(result.type,'image/webp');
 assert.equal(calls[0].width,2000);assert.equal(calls[0].height,1000);assert.equal(calls[0].quality,.82);
 assert.ok(calls[1].quality<calls[0].quality);assert.ok(calls.every(call=>call.width===2000));
});
test('dimensions shrink after quality attempts and restart at good quality',async()=>{
 const calls:{width:number;quality:number}[]=[];
 await fitInventoryPhoto(4000,3000,async(width,_height,type,quality)=>{calls.push({width,quality});return blob(width===2000?2200000:300,type);});
 const smaller=calls.findIndex(call=>call.width<2000);assert.ok(smaller>1);
 assert.equal(calls[smaller].width,1600);assert.equal(calls[smaller].quality,.82);
});
test('unsupported WebP falls back to JPEG and never accepts PNG output',async()=>{
 const types:string[]=[];
 const result=await fitInventoryPhoto(200,400,async(width,height,type)=>{assert.equal(width,200);assert.equal(height,400);types.push(type);return type==='image/webp'?blob(100,'image/png'):blob(500,type);});
 assert.deepEqual(types,['image/webp','image/jpeg']);assert.equal(result.type,'image/jpeg');
});
test('impossible, empty, invalid dimensions and failed encoding return clear errors',async()=>{
 await assert.rejects(()=>fitInventoryPhoto(0,100,async()=>blob(1)),/dimensions/i);
 await assert.rejects(()=>fitInventoryPhoto(Infinity,100,async()=>blob(1)),/dimensions/i);
 await assert.rejects(()=>fitInventoryPhoto(100,100,async()=>null),/process|browser/i);
 await assert.rejects(()=>fitInventoryPhoto(100,100,async()=>blob(0)),/process/i);
 let calls=0;await assert.rejects(()=>fitInventoryPhoto(4000,3000,async()=>{calls++;return blob(2200000);}),/2 MB|smaller/i);assert.ok(calls<60);
});
test('photo size summary shows original and upload sizes',()=>{
 assert.equal(photoSizeLabel(6500000,480000),'Original 6.2 MB -> 469 KB');
});

test('WebP encoder exceptions still allow a JPEG fallback',async()=>{
 const result=await fitInventoryPhoto(400,200,async(_w,_h,type)=>{if(type==='image/webp') throw new Error('Unsupported encoder');return blob(100,'image/jpeg');});
 assert.equal(result.type,'image/jpeg');
});
