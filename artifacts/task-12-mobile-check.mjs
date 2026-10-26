import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const results=[];
 try {
  for(const width of [360,390,430]) {
   const context=await browser.newContext({viewport:{width,height:900},timezoneId:'America/New_York'});
   const page=await context.newPage();
   const hydration=[];
   page.on('console',msg=>{if(msg.type()==='error' && /hydration|didn't match|did not match/i.test(msg.text())) hydration.push(msg.text());});
   for(const view of ['overview','detail','movements','requests']) {
    await page.goto(`http://localhost:3000/dev/inventory-preview?view=${view}&frame=1&role=admin_manager`,{waitUntil:'networkidle',timeout:240000});
    await page.getByRole('heading',{name:view==='overview'?'Quantity by location':view==='detail'?'Recent movements':view==='movements'?'Movements':'Requests',exact:true}).first().waitFor({timeout:60000});
    const text=await page.locator('body').innerText();
    assert.ok(!/\bUTC\b/.test(text),`${width}/${view}: UTC label`);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`${width}/${view}: overflow`);
    if(view==='overview') {assert.ok(text.includes('Junais KP'));assert.ok(text.includes('Team member'));assert.ok(text.includes('26 Oct 2026, 08:56'));assert.ok(text.includes('27 Oct 2026, 01:30'));}
    if(view==='detail') {assert.ok(text.includes('Alex Morgan'));assert.ok(text.includes('Team member'));assert.ok(text.includes('23 Oct 2026, 10:30'));}
    await page.screenshot({path:`artifacts/task-12-${view}-${width}.png`,fullPage:true});
    results.push({width,view,noOverflow:true,dubaiDates:true});
   }
   await page.goto('http://localhost:3000/dev/inventory-preview?view=overview&frame=1&role=viewer',{waitUntil:'networkidle',timeout:240000});
   assert.equal(await page.getByText('Recently added items',{exact:true}).count(),0);
   assert.deepEqual(hydration,[]);
   results.push({width,viewerActivityHidden:true,hydrationErrors:0});
   await context.close();
   console.log(`PASS ${width}px`);
  }
  fs.writeFileSync('artifacts/task-12-browser-results.json',JSON.stringify(results,null,2)+'\n');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
