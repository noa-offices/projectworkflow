// Real review components with deterministic in-memory server actions; no live database.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const out = resolve("artifacts/task-19c"); await mkdir(out,{recursive:true});
const decisionActions = `
const state=globalThis.__carryTest={saved:[],earlier:[],ownLoads:0,carryLoads:0,saves:[],failCarry:false};
export async function listSupplierPriceDecisions(){state.ownLoads++;return structuredClone(state.saved);}
export async function listSupplierCarryOverDecisions(){state.carryLoads++;if(state.failCarry)throw Error('offline');return structuredClone(state.earlier);}
export async function saveSupplierPriceDecisions(rows){state.saves.push(structuredClone(rows));const result=rows.map((r)=>({...r,id:r.model_code,decided_by:'manager',decided_by_name:'Amal Carry Manager',decided_at:'2026-10-27T09:00:00Z',updated_by:'manager',updated_at:'2026-10-27T09:00:00Z'}));for(const r of result){const i=state.saved.findIndex(x=>x.model_code===r.model_code&&x.price_field===r.price_field);if(i<0)state.saved.push(r);else state.saved[i]=r;}return structuredClone(result);}`;
const checkActions = `export async function checkSmartSetupSupplierPrices(){throw Error('check must not rerun');}export async function listSmartSetupSupplierSourcesAction(){throw Error('sources are supplied');}`;
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SupplierVerificationPanel}from'@/components/products/smart-setup-supplier-verification';
const params=new URLSearchParams(location.search),readonly=params.has('readonly');
const source={versionId:'19c00000-0000-0000-0002-000000000003',definitionId:'d',title:'INTERSTUHL - November 2026',currency:'EUR',basis:'list'};
const names=['Arc task chair','Linear workstation','Meeting table','Storage cabinet','Guest chair'];
const statuses=['MISMATCH','MISMATCH','MISMATCH','NOT_FOUND','NEEDS_REVIEW'];
const results=Array.from({length:5},(_,i)=>({locator:'r'+i,role:'main_product',code:'A'+(i+1),priceField:'unit_price',dimension:'',status:statuses[i],reason:i===3?'no_source_candidate':i===4?'needs_dimension_mapping':'price_differs',importedPrice:120+i*10,importedCurrency:'EUR',referencePrice:i>=3?null:100,referenceCurrency:'EUR',source,evidence:null}));
const fresh={fingerprint:'fixture',output:{source,results},cells:results.map((r,i)=>({locator:r.locator,label:names[i],dimensionLabel:'Standard'})),unsupported:[]};
const old=(code,patch={})=>({model_code:code,price_field:'unit_price',category:'Standard',decision:'set_custom',custom_price:85,note:'Check the finish',imported_price:120,supplier_price:100,currency:'EUR',decided_at:'2026-10-26T12:00:00Z',decided_by_name:'Junais KP',from_source_id:'19c00000-0000-0000-0002-000000000001',from_label:'INTERSTUHL - October 2026',...patch});
globalThis.__carryTest.earlier=[old('A1'),old('A2',{supplier_price:90,decision:'keep_imported',custom_price:null}),old('A5',{supplier_price:null,decision:'use_supplier',custom_price:null})];
globalThis.__carryTest.saved=[{...old('A3',{decision:'keep_imported',custom_price:null,note:null}),id:'saved-A3',supplier_source_id:source.versionId,supplier_price_list_label:source.title,status:'open',decided_by:'manager',updated_by:'manager',updated_at:'2026-10-26T12:00:00Z'}];
globalThis.__carryTest.failCarry=params.has('carryError');
const option={definitionId:'d',name:'INTERSTUHL',versionId:source.versionId,versionTitle:source.title,effectiveFrom:null,receivedAt:null,currency:'EUR',basis:'list'};
function Preview(){const[open,setOpen]=useState(false);return <SupplierVerificationPanel brandId='b' sources={{state:'ready',options:[option],canManageDecisions:!readonly}} definitionId='d' onSelect={()=>{}} selected={option} running={false} error={null} stale={false} fresh={fresh} reviewOpen={open} onReviewOpen={()=>setOpen(true)} onReviewClose={()=>setOpen(false)} onRun={()=>{throw Error('check must not rerun')}}/>;}createRoot(document.getElementById('root')).render(<Preview/>);`;
const bundle=await build({stdin:{contents:fixture,loader:"tsx",sourcefile:"carry-preview.tsx",resolveDir:process.cwd()},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",plugins:[{name:"mock-server-actions",setup(b){b.onResolve({filter:/supplier-review-decision-actions$/},()=>({path:"decisions",namespace:"mock"}));b.onResolve({filter:/smart-setup-supplier-check-actions$/},()=>({path:"check",namespace:"mock"}));b.onLoad({filter:/.*/,namespace:"mock"},(args)=>({contents:args.path==="decisions"?decisionActions:checkActions,loader:"js"}));}}]});
const css=await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../../components/products/smart-setup-supplier-review-dialog.tsx"; @source "../../components/products/supplier-review-decision-controls.tsx"; @source "../../components/products/smart-setup-supplier-verification.tsx"; body { font-family: Arial, sans-serif; background: #f4f4f5; }',{from:resolve(out,"input.css")});
const html='<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task 19c fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>';
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/bundle.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css.css:html);});
await new Promise(done=>server.listen(0,"127.0.0.1",done));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));const checks=[];
const visible=(selector)=>page.locator(`${selector}:visible`);
const action=(code)=>visible(`select[aria-label^="Action for ${code} "]`);
const button=(name)=>page.getByRole("button",{name,exact:true}).filter({visible:true});
const dialog=()=>page.getByRole("dialog",{name:"Supplier price review"});
const loaded=()=>page.waitForFunction(()=>!document.body.innerText.includes("Loading saved decisions"));
try{
 await page.goto(url);await page.getByText('1 decided',{exact:false}).waitFor();
 assert.deepEqual(await page.evaluate(()=>[globalThis.__carryTest.ownLoads,globalThis.__carryTest.carryLoads]),[1,1],"footer loads both lists");
 await button('Open full review').click();await loaded();
 assert.deepEqual(await page.evaluate(()=>[globalThis.__carryTest.ownLoads,globalThis.__carryTest.carryLoads]),[2,2]);
 assert.equal(await dialog().locator('input[type="checkbox"]:checked').count(),0);
 assert.equal(await action('A1').inputValue(),'set_custom');
 assert.equal(await visible('input[aria-label^="My price for A1 "]').inputValue(),'85');
 assert.equal(await dialog().getByText('1 unsaved change',{exact:true}).count(),1);
 assert.match(await dialog().innerText(),/Carried over 1.*Price changed 2.*New 1.*Saved 1/s);
 assert.equal(await dialog().locator('span[title*="From INTERSTUHL - October 2026"]:visible').count(),1);
 assert.equal(await action('A2').inputValue(),'');assert.equal(await action('A5').inputValue(),'');
 assert.match(await visible('span[title*="Earlier action:"]').first().getAttribute('title'),/From INTERSTUHL/);
 assert.equal(await dialog().getByText('1 decided',{exact:false}).count(),1,"dialog footer counts saved only");
 assert.equal(await page.evaluate(()=>globalThis.__carryTest.saves.length),0);
 checks.push('footer and dialog both load histories; no pre-selected rows or auto-save; prefill, counts and both warning tags');
 await dialog().getByRole('button',{name:'Carried over 1',exact:true}).click();assert.equal(await dialog().getByText('Showing 1 of 5 rows').count(),1);
 await dialog().getByRole('button',{name:'Carried over 1',exact:true}).click();
 await dialog().getByRole('button',{name:'Price changed 2',exact:true}).click();assert.equal(await dialog().getByText('Showing 2 of 5 rows').count(),1);
 await dialog().getByRole('button',{name:'Price changed 2',exact:true}).click();
 checks.push('carry-over and price-changed chips filter rows without selecting them');
 for(const width of [1440,1024,390]){await page.setViewportSize({width,height:width===390?844:1000});if(width<1280){await page.getByRole('region',{name:'Supplier price rows'}).evaluate(el=>el.scrollTop=0);}await page.screenshot({path:resolve(out,`supplier-carry-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 checks.push('screenshots at 1440, 1024 and 390 px; no horizontal page overflow');
 await page.setViewportSize({width:1440,height:1000});
 await action('A1').selectOption('');assert.equal(await dialog().getByText('1 unsaved change').count(),0);
 assert.equal(await page.evaluate(()=>globalThis.__carryTest.saves.length),0);
 await button('Close').click();await button('Open full review').click();await loaded();assert.equal(await action('A1').inputValue(),'set_custom');
 await button('Save decisions').click();await dialog().getByText('1 decision saved. Product prices have not changed.').waitFor();
 assert.equal(await page.evaluate(()=>globalThis.__carryTest.saves.length),1);assert.equal(await page.evaluate(()=>globalThis.__carryTest.saved.some(r=>r.model_code==='A1')),true);
 assert.equal(await dialog().getByText('2 decided',{exact:false}).count(),1);
 checks.push('clearing suppresses an earlier suggestion locally; reopening restores it; explicit Save writes only to current-source decisions');
 await page.goto(url+'/?carryError');await button('Open full review').click();await loaded();await dialog().getByText(/Earlier decisions could not be loaded/).waitFor();
 assert.equal(await action('A1').isDisabled(),false);assert.equal(await button('Export CSV').isDisabled(),true);
 await page.goto(url+'/?readonly');await button('Open full review').click();assert.equal(await page.locator('select[aria-label^="Action for"]').count(),0);
 assert.deepEqual(await page.evaluate(()=>[globalThis.__carryTest.ownLoads,globalThis.__carryTest.carryLoads]),[0,0]);
 checks.push('carry-over failure leaves actions usable; non-managers see no carry controls and call neither RPC');
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'browser-results.json'),JSON.stringify({checks,browserErrors:errors,screenshots:[1440,1024,390],fixtureOnly:true},null,2));console.log(JSON.stringify({checks:checks.length,browserErrors:errors.length,screenshots:[1440,1024,390]}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
