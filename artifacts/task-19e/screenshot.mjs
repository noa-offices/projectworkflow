// Local review fixture: captures the real dialog before any selection.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium } from "playwright";

const out = resolve("artifacts/task-19e"); await mkdir(out,{recursive:true});
const fixture = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{SupplierReviewDialog}from'@/components/products/smart-setup-supplier-review-dialog';
const source={versionId:'19b00000-0000-0000-0002-000000000001',definitionId:'d',title:'October 2026 furniture list',currency:'EUR',basis:'list'};
const results=['A1','A2','A3'].map((code,i)=>({locator:code,role:'main_product',code,priceField:'unit_price',dimension:'',status:i===1?'NEEDS_REVIEW':i===2?'MATCHED':'MISMATCH',reason:i===1?'needs_dimension_mapping':i===2?'same_price':'price_differs',importedPrice:120+i*10,importedCurrency:'EUR',referencePrice:i===1?null:100,referenceCurrency:'EUR',source,evidence:null}));
const fresh={fingerprint:'opening',output:{source,results},cells:results.map((r,i)=>({locator:r.locator,label:['Arc task chair','Linear workstation','Meeting table'][i],dimensionLabel:'Standard'})),unsupported:[]};
function Preview(){const[open,setOpen]=useState(true);return <><button onClick={()=>setOpen(true)}>Open full review</button>{open&&<SupplierReviewDialog fresh={fresh} stale={false} selected={null} canManageDecisions={true} onClose={()=>setOpen(false)}/>}</>;}createRoot(document.getElementById('root')).render(<Preview/>);`;
const actions='export async function listSupplierPriceDecisions(){return [];}export async function saveSupplierPriceDecisions(rows){return rows;}';
const bundle=await build({stdin:{contents:fixture,loader:"tsx",sourcefile:"opening-review.tsx",resolveDir:process.cwd()},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",plugins:[{name:"stub-decision-actions",setup(b){b.onResolve({filter:/supplier-review-decision-actions$/},()=>({path:"stub",namespace:"stub"}));b.onLoad({filter:/.*/,namespace:"stub"},()=>({contents:actions,loader:"js"}));}}]});
const css=await postcss([tailwind()]).process('@import "tailwindcss" source(none); @source "../../components/products/smart-setup-supplier-review-dialog.tsx"; @source "../../components/products/supplier-review-decision-controls.tsx"; body { font-family: Arial, sans-serif; }',{from:resolve(out,"input.css")});
const html='<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task 19e opening</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script></html>';
const server=createServer((req,res)=>{res.setHeader("Content-Type",req.url==="/bundle.js"?"text/javascript":req.url==="/style.css"?"text/css":"text/html");res.end(req.url==="/bundle.js"?bundle.outputFiles[0].text:req.url==="/style.css"?css.css:html);});
await new Promise(done=>server.listen(0,"127.0.0.1",done));const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!document.body.innerText.includes('Loading saved decisions'));
 const dialog=page.getByRole('dialog',{name:'Supplier price review'}), selected=()=>dialog.locator('input[type="checkbox"]:checked');
 assert.equal(await selected().count(),0);assert.equal(await dialog.getByText(/\d+ selected/).count(),0);
 await page.screenshot({path:resolve(out,'supplier-review-opening-1440.png'),fullPage:true});
 await dialog.locator('input[aria-label^="Select A1"]').last().check();await dialog.locator('input[aria-label^="Select A2"]').last().check();assert.ok(await dialog.getByText('2 selected').count()>0);
 await dialog.getByRole('searchbox').fill('A1');assert.ok(await dialog.getByText('1 selected').count()>0);
 await dialog.getByRole('searchbox').fill('');assert.equal(await dialog.locator('input[aria-label^="Select A2"]').last().isChecked(),false);
 await dialog.getByRole('combobox',{name:'Sort by'}).selectOption('model');assert.ok(await dialog.getByText('1 selected').count()>0);
 await dialog.getByRole('combobox',{name:'Bulk action'}).selectOption('keep_imported');await dialog.getByRole('button',{name:'Apply to selected'}).click();assert.equal(await selected().count(),0);
 await dialog.getByRole('button',{name:'Close'}).click();await dialog.getByRole('button',{name:'Discard and close'}).click();await page.getByRole('button',{name:'Open full review'}).click();await page.waitForFunction(()=>!document.body.innerText.includes('Loading saved decisions'));assert.equal(await selected().count(),0);
 console.log('Opening screenshot captured; visible-only selection, bulk clear and reopen checks passed.');}
finally{await browser.close();await new Promise(done=>server.close(done));}
