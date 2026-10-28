const { chromium } = require('playwright');
const fs = require('fs');
const results = [];
(async()=>{
 const browser=await chromium.launch({headless:true});
 const cases=[['manager-dialog','view=requests&role=admin_manager&dialog=clear&status=all'],['manager-cleared','view=requests&role=admin_manager&cleared=1&status=all'],['own-requests','view=requests&role=sales_coordinator&status=all'],['product-detail','view=detail&role=sales_coordinator']];
 for (const width of [390,1440]) for (const [name,query] of cases) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const response=await page.goto(`http://localhost:3020/dev/inventory-preview?frame=1&${query}`,{waitUntil:'networkidle',timeout:60000});
  if(name==='manager-dialog') await page.getByRole('dialog').waitFor({state:'visible'});
  else if(name==='product-detail') await page.getByText('Product details',{exact:true}).first().waitFor({state:'visible'});
  else await page.getByRole('heading',{name: name === 'own-requests' ? 'My requests' : 'Requests'}).first().waitFor({state:'visible'});
  const body=await page.locator('body').innerText();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const result={width,name,status:response?.status(),url:page.url(),overflow}; results.push(result); console.log(JSON.stringify(result));
  if (!response?.ok() || !body.includes('Inventory') || overflow) throw Error('Preview failed or overflows');
  if(name==='manager-dialog'&&!body.includes('Hide 2 finished requests?')) throw Error('Dialog missing');
  if(name==='manager-cleared'&&(!body.includes('Cleared')||!body.includes('Restore'))) throw Error('Cleared controls missing');
  if(name==='own-requests'&&(!body.includes('My requests')||body.includes('Clear history')||await page.getByRole('link',{name:'Movements',exact:true}).count())) throw Error('Nonmanager privacy mismatch');
  if(name==='product-detail'&&(body.includes('Recent movements')||body.includes('All movements for this product'))) throw Error('Movement section exposed');
  await page.screenshot({path:`artifacts/inventory-privacy/${name}-${width}.png`,fullPage:true});
  await page.close();
 }
 fs.writeFileSync('artifacts/inventory-privacy/assertions.json',JSON.stringify({disclaimer:'Synthetic preview data; no production data was used.',results},null,2));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
