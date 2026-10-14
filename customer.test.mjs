import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const {escapeHtml,safeImageUrl,readSession,quoteText} = require('./customer.js');
const source = readFileSync(new URL('./customer.js',import.meta.url),'utf8');
const origin = 'https://fwhsngnjwwlzdgkrdzrp.supabase.co';
test('escapes untrusted HTML in text and attributes',()=>assert.equal(escapeHtml('<img src="x" onerror=\'x\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;'));
test('only accepts signed assets on the project storage host',()=>{
  assert.equal(safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safeImageUrl('https://evil.example/storage/v1/object/sign/a'), '');
  assert.equal(safeImageUrl(origin+'/auth/v1/token'), '');
  assert.equal(safeImageUrl(origin+'/storage/v1/object/sign/assets/a?token=abc'), origin+'/storage/v1/object/sign/assets/a?token=abc');
});
test('session validation rejects malformed or incomplete storage',()=>{
  assert.equal(readSession(null),null); assert.equal(readSession({access_token:'a'}),null);
  assert.deepEqual(readSession({access_token:'a',refresh_token:'r',expires_in:3600},100000),{access_token:'a',refresh_token:'r',expires_at:3700});
});
test('quote uses explicit credit amount without claiming final pricing',()=>{
  assert.equal(quoteText({quote:{credits:6}}),'6 Peter Credits (draft estimate).');
  assert.match(quoteText({quote:{credits:0}}),/without a credit price/);
});
function harness({stored = null,respond} = {}) {
  const nodes = new Map(),calls = [],storage = new Map(stored ? [['pcs.customer.session.v1',JSON.stringify(stored)]] : []);
  const document = {getElementById(id){if(!nodes.has(id)) {
    const classes = new Set(),handlers = {};
    nodes.set(id,{id,value:'',textContent:'',innerHTML:'',disabled:false,className:'',handlers,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c)},addEventListener:(event,fn)=>{handlers[event]=fn;}});
  } return nodes.get(id);}};
  vm.runInNewContext(source,{document,URL,URLSearchParams,location:{hash:''},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,v)=>storage.set(key,v),removeItem:key=>storage.delete(key)},fetch:async(url,options)=>{calls.push({url,options}); const data=await respond?.(url,options); return data?.__response || {ok:true,status:200,json:async()=>data||{}};},Date,console});
  return {nodes,calls,storage,node:id=>document.getElementById(id)};
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
test('loading preview makes no auth, generation, or external request',()=>assert.equal(harness().calls.length,0));
test('sign-in loads only current customer endpoints and clears password',async()=>{
  const h = harness({respond:url=>url.includes('/auth/') ? {access_token:'access',refresh_token:'refresh',expires_at:Date.now()/1000+3600} : url.endsWith('me') ? {user:{email:'p@example.com',credits:75}} : url.endsWith('pricing') ? {plans:[{name:'<script>bad</script>',monthlyCredits:150,priceCents:1900}]} : {assets:[]}});
  h.node('customerEmail').value='p@example.com'; h.node('customerPassword').value='secret';
  await h.node('customerSignIn').handlers.submit({preventDefault(){}});
  assert.equal(h.node('customerPassword').value,''); assert.equal(h.node('customerBalance').textContent,'75');
  assert.match(h.node('customerPlans').innerHTML,/&lt;script&gt;/); assert.match(h.node('customerPlans').innerHTML,/\$19.00\/month/);
  assert.equal(h.calls.length,4); assert.ok(h.calls.slice(1).every(c=>c.options.headers.Authorization==='Bearer access'));
  assert.ok(h.calls.every(c=>!c.options.headers['x-studio-token']));
});
test('expired session refreshes once before parallel account reads',async()=>{
  const h = harness({stored:{access_token:'expired',refresh_token:'refresh',expires_at:1},respond:url=>url.includes('/auth/') ? {access_token:'new',refresh_token:'next',expires_in:3600} : url.endsWith('me') ? {user:{credits:4}} : {plans:[],assets:[]}});
  h.node('customerTab').handlers.click(); await tick(); await tick();
  assert.equal(h.calls.filter(c=>c.url.includes('grant_type=refresh_token')).length,1);
  assert.ok(h.calls.filter(c=>c.url.includes('studio-customer')).every(c=>c.options.headers.Authorization==='Bearer new'));
});
test('quote sends prompt to quote endpoint only; no generation control is present',async()=>{
  const h = harness({stored:{access_token:'a',refresh_token:'r',expires_at:Date.now()/1000+3600},respond:()=>({quote:{credits:12}})});
  h.node('customerPrompt').value='A violet orb'; h.node('customerRatio').value='1:1'; h.node('customerQuality').value='low';
  await h.node('customerQuoteForm').handlers.submit({preventDefault(){}});
  assert.equal(h.calls.length,1); assert.ok(h.calls[0].url.endsWith('?action=quote'));
  assert.deepEqual(JSON.parse(h.calls[0].options.body),{action:'quote',prompt:'A violet orb',aspectRatio:'1:1',quality:'low'});
  assert.equal(h.node('customerQuoteResult').textContent,'12 Peter Credits (draft estimate).');
  const html=readFileSync(new URL('./index-m2-fixed.html',import.meta.url),'utf8');
  assert.match(html,/disabled>Generation unavailable/); assert.doesNotMatch(source,/api\(['"]generate/);
});
test('sign-out clears session/private customer content and revokes local server session',async()=>{
  const h = harness({stored:{access_token:'a',refresh_token:'r',expires_at:Date.now()/1000+3600}});
  h.node('customerAssets').textContent='private'; h.node('customerPrompt').value='private prompt';
  await h.node('customerSignOut').handlers.click();
  assert.equal(h.storage.size,0); assert.equal(h.node('customerAssets').textContent,''); assert.equal(h.node('customerPrompt').value,'');
  assert.equal(h.calls.length,1); assert.ok(h.calls[0].url.endsWith('/auth/v1/logout?scope=local'));
});

test('refresh rejection clears private content without issuing customer requests',async()=>{
  const h = harness({stored:{access_token:'expired',refresh_token:'invalid',expires_at:1},respond:()=>({__response:{ok:false,status:400,json:async()=>({error:'Refresh token expired'})}})});
  h.node('customerAssets').textContent='private asset'; h.node('customerIdentity').textContent='private identity';
  h.node('customerTab').handlers.click(); await tick(); await tick();
  assert.equal(h.calls.length,1); assert.ok(h.calls[0].url.includes('grant_type=refresh_token'));
  assert.equal(h.storage.size,0); assert.equal(h.node('customerAssets').textContent,''); assert.equal(h.node('customerIdentity').textContent,'');
  assert.ok(h.node('customerAccount').classList.contains('hide'));
});
test('library reports QA state and never embeds an unsigned or foreign URL',async()=>{
  const h = harness({stored:{access_token:'a',refresh_token:'r',expires_at:Date.now()/1000+3600},respond:url=>url.endsWith('me') ? {user:{credits:4}} : url.endsWith('pricing') ? {plans:[]} : {assets:[{qaStatus:'PENDING',url:'https://evil.example/a.png'},{qaStatus:'PASS',url:origin+'/storage/v1/object/sign/assets/image?token=signed'}]}});
  h.node('customerTab').handlers.click(); await tick(); await tick();
  assert.match(h.node('customerAssets').innerHTML,/QA: PENDING/); assert.match(h.node('customerAssets').innerHTML,/QA: PASS/);
  assert.doesNotMatch(h.node('customerAssets').innerHTML,/evil.example/); assert.match(h.node('customerAssets').innerHTML,/token=signed/);
});

test('guest preview uses labelled samples with no network calls or stored credentials',async()=>{
  const h=harness(); h.node('customerDemo').handlers.click();
  assert.match(h.node('customerBalance').textContent,/sample/);
  assert.match(h.node('customerStatus').textContent,/DEMO/);
  assert.ok(!h.node('customerAccount').classList.contains('hide'));
  await h.node('customerQuoteForm').handlers.submit({preventDefault(){}});
  assert.match(h.node('customerQuoteResult').textContent,/not a live quote/);
  assert.equal(h.calls.length,0); assert.equal(h.storage.size,0);
});
test('exiting preview preserves an existing real session without logout or any API call',async()=>{
  const h=harness({stored:{access_token:'a',refresh_token:'r',expires_at:Date.now()/1000+3600}});
  const before=h.storage.get('pcs.customer.session.v1');
  h.node('customerDemo').handlers.click(); await h.node('customerSignOut').handlers.click();
  assert.equal(h.storage.get('pcs.customer.session.v1'),before);
  assert.ok(h.node('customerAccount').classList.contains('hide')); assert.equal(h.calls.length,0);
});
