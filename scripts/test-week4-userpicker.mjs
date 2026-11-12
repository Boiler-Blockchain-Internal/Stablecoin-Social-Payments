import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {authFixture,withBrowserFixture} from './browser-fixture.mjs';

await withBrowserFixture('week4-userpicker',`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {UserPicker} from './src/components/UserPicker';function App(){const [value,setValue]=useState('');const [selected,setSelected]=useState(null);return <form onSubmit={e=>{e.preventDefault();window.submitted=(window.submitted??0)+1;}}><div onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();window.parentAdds=(window.parentAdds??0)+1;}}}><UserPicker value={value} onChange={setValue} onSelect={setSelected} label="Members"/></div><output hidden data-testid="selected">{JSON.stringify(selected)}</output></form>;}createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-xl p-4"><App/></main>);`,{
  '@privy-io/react-auth':authFixture,
  '@/features/auth/searchUsers':`export async function searchUsers(query){window.searches=(window.searches??[]).concat(query);if(query==='slow')await new Promise(resolve=>setTimeout(resolve,700));if(query==='error')throw new Error('fixture failure');return [{id:'1',username:'alice'},{id:'2',username:'alicia'},{id:'3',username:'bob'},{id:'4',username:'slow_user'}].filter(row=>row.username.includes(query.toLowerCase()));}`,
},async({page,browser,origin,directory})=>{
  await page.goto(origin);
  const input=page.getByRole('combobox');
  await input.fill('ali');await page.getByRole('option',{name:'@alice',exact:true}).waitFor();
  await input.press('ArrowDown');await input.press('Enter');
  assert.equal(await page.evaluate(()=>window.parentAdds??0),0);
  const clear=page.getByRole('button',{name:'Clear',exact:true});
  await clear.focus();await clear.press('Enter');
  assert.equal(await page.evaluate(()=>window.parentAdds??0),0,'Keyboard Clear must not trigger Groups parent Enter-to-add shortcut.');
  assert.equal(await input.inputValue(),'');
  assert.equal(await page.getByTestId('selected').textContent(),'null');
  if(process.argv.includes('--repro-only'))return;
  assert.ok((await input.boundingBox()).height>=44,'Mobile input target should be at least 44 CSS px.');
  const touch=await browser.newPage({hasTouch:true,isMobile:true,viewport:{width:320,height:640}});
  await touch.goto(origin);const touchInput=touch.getByRole('combobox');
  await touchInput.fill('al');await touch.getByRole('option',{name:'@alice',exact:true}).tap();
  assert.deepEqual(JSON.parse(await touch.getByTestId('selected').textContent()),{id:'1',username:'alice'});
  const touchClear=touch.getByRole('button',{name:'Clear',exact:true});
  assert.ok((await touchClear.boundingBox()).height>=44);
  await touchClear.tap();assert.equal(await touchInput.inputValue(),'');
  for(const width of [320,375,390]){
    await touch.setViewportSize({width,height:812});await touchInput.fill('ali');
    await touch.getByRole('option',{name:'@alice',exact:true}).waitFor();
    assert.ok(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(width===375)await touch.screenshot({path:resolve(directory,'userpicker-mobile.png'),fullPage:true});
  }
  await touch.evaluate(()=>{window.searches=[];});
  await touchInput.fill('b');await touchInput.fill('bo');await touchInput.fill('bob');
  await touch.getByRole('option',{name:'@bob',exact:true}).waitFor();
  assert.deepEqual(await touch.evaluate(()=>window.searches),['bob']);
  await touchInput.fill('slow');await touch.waitForFunction(()=>window.searches.includes('slow'));
  await touchInput.fill('bob');await touch.getByRole('option',{name:'@bob',exact:true}).waitFor();
  await touch.waitForTimeout(800);assert.equal(await touch.getByRole('option').innerText(),'@bob');
  await touchInput.fill('error');await touch.getByRole('alert').waitFor();
  await touchInput.fill('missing');await touch.getByRole('status').filter({hasText:'No users found'}).waitFor();
  await touch.close();
  console.log('PASS: Groups-style parent Enter isolation for select/Clear, 44px targets, touch selection/clear, debounce, late responses, errors/empty, and 320/375/390px fit. Emulated touch, not a physical phone.');
});
