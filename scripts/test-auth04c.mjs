import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto,randomBytes} from 'node:crypto';
import {AdminUsersPanel} from '../js/admin-users-ui.js';
import {revealIssuedCode,AdminUsersError} from '../js/admin-users.js';
import {createCode,hmacHex} from '../supabase/functions/_shared/auth02-core.mjs';
import {encryptIssuedCode,decryptIssuedCode} from '../supabase/functions/_shared/auth04-code-crypto.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const code=createCode(new Uint8Array(20).fill(9));
const id='11111111-1111-4111-8111-111111111111';
const key=randomBytes(32).toString('hex');
const hmac='separate-hmac-secret-more-than-thirty-two-characters';
const config={projectUrl:'https://test-project.supabase.co',publishableKey:'sb_publishable_ABCDEFGHIJKLMNOP'};
const session={access_token:'fake-user-jwt'};
const link=`https://followyes.github.io/ai-or-human/#register=${encodeURIComponent(code)}`;
const meta={id,code_hint:code.slice(-4),status:'available',expires_at:'2027-01-01T00:00:00Z',can_reveal:true,can_delete:true};
const result=(response,status=200)=>({ok:status>=200 && status<300,status,json:async()=>response});
const opts=(response,status=200)=>({session,config,fetchImpl:async()=>result(response,status)});

test('AUTH-04C AES-GCM envelope roundtrips and differs for each issue',async()=>{
  const a=await encryptIssuedCode(code,id,key,webcrypto);
  const b=await encryptIssuedCode(code,id,key,webcrypto);
  assert.notEqual(a.nonce,b.nonce);
  assert.notEqual(a.ciphertext,b.ciphertext);
  assert.doesNotMatch(JSON.stringify(a),new RegExp(code));
  const digest=await hmacHex(hmac,`code:${code}`,webcrypto);
  assert.deepEqual(await decryptIssuedCode({...a,code_hint:code.slice(-4),code_digest:digest},key,hmac,webcrypto),{code,link});
});
test('AUTH-04C fails closed for tampering, wrong code ID, version, key or digest',async()=>{
  const a=await encryptIssuedCode(code,id,key,webcrypto);
  const digest=await hmacHex(hmac,`code:${code}`,webcrypto);
  const row={...a,code_hint:code.slice(-4),code_digest:digest};
  const rejects=async (envelope,providedKey=key)=>{
    await assert.rejects(decryptIssuedCode(envelope,providedKey,hmac,webcrypto),
      error=>['CODE_INTEGRITY_FAILED','CODE_ENCRYPTION_NOT_CONFIGURED'].includes(error.code));
  };
  await rejects({...row,code_digest:'0'.repeat(64)});
  await rejects({...row,code_hint:'AAAA'});
  await rejects({...row,id:'22222222-2222-4222-8222-222222222222'});
  await rejects({...row,key_version:2});
  await rejects({...row,nonce:'wrong'});
  await rejects({...row,ciphertext:row.ciphertext.slice(0,-3)+'AAA'});
  await rejects(row,randomBytes(32).toString('hex'));
  await rejects(row,'bad-secret');
});
test('AUTH-04C reveal response validates same code and canonical registration link',async()=>{
  const good=await revealIssuedCode(id,opts({id,code,link}));
  assert.deepEqual(good,{id,code,link});
  await assert.rejects(revealIssuedCode(id,opts({id,code,link:'https://evil.example/#register='+code})),
    error=>error instanceof AdminUsersError && error.code==='RESPONSE');
  await assert.rejects(revealIssuedCode(id,opts({error:'CODE_NOT_REVEALABLE'},409)),
    error=>error.code==='CODE_NOT_REVEALABLE');
  await assert.rejects(revealIssuedCode('bad',opts({id,code,link})),/Nieprawidłowy identyfikator/);
});

class FakeNode {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase(); this.children=[];this.listeners=new Map();this.dataset={};
    this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.isConnected=true;
  }
  addEventListener(kind,fn){this.listeners.set(kind,fn);}
  setAttribute(){}
  append(...values){this.children.push(...values);}
  replaceChildren(...values){this.children=values;}
  closest(selector){return selector==='[data-users-action]'&&this.dataset.usersAction?this:null;}
  select(){this.selected=true;}
  focus(){this.focused=true;}
  querySelectorAll(selector){
    const descendants=[];
    const visit=node=>{for(const child of node.children){descendants.push(child);visit(child);}};
    visit(this);
    return descendants.filter(child=>selector==='[data-users-action]'?Boolean(child.dataset.usersAction):
      selector==='input[data-code-field]'&&child.tagName==='INPUT'&&Boolean(child.dataset.codeField));
  }
}
function fakePanel(fetchImpl,{confirmation=true,copyText=async()=>{}}={}){
  const ids=['generate-form','code-count','code-days','generate-button','code-filter','codes-list',
    'codes-refresh','account-search','account-filter','accounts-list','accounts-more','status','toast'];
  const els=Object.fromEntries(ids.map(id=>[`users-${id}`,new FakeNode()]));
  els['users-code-count'].value='1'; els['users-code-days'].value='7';
  const root={ownerDocument:{createElement:tag=>new FakeNode(tag),createDocumentFragment:()=>new FakeNode()},
    querySelector:selector=>els[selector.slice(1)],querySelectorAll:selector=>
      [...els['users-codes-list'].querySelectorAll(selector),...els['users-accounts-list'].querySelectorAll(selector)]};
  const confirmations=[];
  const panel=new AdminUsersPanel({root,getSession:async()=>session,fetchImpl,
    confirmAction:message=>{confirmations.push(message);return confirmation;},copyText});
  return {panel,els,confirmations};
}
const walk=root=>[root,...root.children.flatMap(walk)];
const action=(els,type)=>walk(els['users-codes-list']).find(el=>el.dataset.usersAction===type);

test('AUTH-04C reopen after reload uses server, copy, hide and clears secrets on tab switch',async()=>{
  const requests=[],copied=[];
  const fetchImpl=async (_,options)=>{
    const request=JSON.parse(options.body);requests.push(request.action);
    if(request.action==='list')return result({codes:[meta]});
    if(request.action==='users')return result({accounts:[],total:0});
    if(request.action==='reveal')return result({id,code,link});
    throw new Error('unexpected: '+request.action);
  };
  const {panel,els}=fakePanel(fetchImpl,{copyText:async text=>copied.push(text)});
  panel.setActive(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(panel.codesLoaded,true);
  assert.equal(panel.revealed.size,0);
  assert.ok(action(els,'reveal'));
  els['users-codes-list'].listeners.get('click')({target:action(els,'reveal')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual([...panel.revealed.keys()],[id]);
  const field=walk(els['users-codes-list']).find(el=>el.dataset.codeField==='code');
  assert.equal(field.value,code);
  field.listeners.get('focus')();assert.equal(field.selected,true);
  els['users-codes-list'].listeners.get('click')({target:action(els,'copy-code')});
  await new Promise(resolve=>setImmediate(resolve));
  els['users-codes-list'].listeners.get('click')({target:action(els,'copy-link')});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(copied,[code,link]);
  els['users-codes-list'].listeners.get('click')({target:action(els,'hide')});
  assert.equal(panel.revealed.size,0);
  panel.setActive(false);assert.equal(panel.revealed.size,0);
  panel.setActive(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(panel.revealed.size,0);
  assert.equal(requests.filter(x=>x==='list').length,2);
  assert.equal(requests.filter(x=>x==='reveal').length,1);
  panel.clear();
});

test('AUTH-04C refuses blind generation and asks before issuing more active codes',async()=>{
  let issues=0;
  const fetchImpl=async (_,options)=>{
    const {action:actionName}=JSON.parse(options.body);
    if(actionName==='generate'){issues++;return result({codes:[{id,code,link}],expires_at:meta.expires_at},201);}
    throw new Error('unexpected action');
  };
  const {panel,confirmations}=fakePanel(fetchImpl,{confirmation:false});
  panel.load=async()=>{};panel.setActive(true);
  await panel.generate();assert.equal(issues,0);
  panel.codesLoaded=true;panel.codes=[meta];
  await panel.generate();assert.equal(issues,0);
  assert.equal(confirmations.length,1);
  panel.clear();
  const second=fakePanel(fetchImpl);
  second.panel.load=async()=>{};second.panel.setActive(true);
  second.panel.codesLoaded=true;second.panel.codes=[meta];
  await second.panel.generate();assert.equal(issues,1);
  assert.equal(second.panel.revealed.get(id).code,code);
  assert.equal(second.els['users-codes-list'].children.length,1);
  second.panel.clear();
});

test('AUTH-04C canonical source enforces RPC, permissions, privacy and history preservation',()=>{
  const sqlFile=join(root,'..','OUTSIDE_REPO','SQL','AUTH_04C_RECOVERABLE_CODES.sql');
  const sql=existsSync(sqlFile)?readFileSync(sqlFile,'utf8'):null;
  const html=readFileSync(join(root,'admin/index.html'),'utf8');
  const script=readFileSync(join(root,'js/admin-users-ui.js'),'utf8');
  const edge=readFileSync(join(root,'supabase/functions/auth02-admin/index.ts'),'utf8');
  if (sql) {
    assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
    assert.match(sql,/REVOKE ALL ON TABLE private\.registration_code_envelopes FROM PUBLIC, anon, authenticated/);
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.auth04_reveal_available_code/);
    assert.match(sql,/c\.status='available' AND c\.expires_at>now\(\)/);
    assert.match(sql,/DELETE FROM private\.registration_code_envelopes WHERE code_id=v_attempt\.code_id/);
    assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.auth04_reveal_available_code\(uuid\) TO service_role/);
    assert.doesNotMatch(sql,/DELETE FROM public\.game_results|DELETE FROM public\.player_accounts/);
  }
  assert.match(edge,/case 'reveal'/);
  assert.match(edge,/const actor=await ensureAdmin\(req\)/);
  assert.doesNotMatch(script,/issuedCodes|sessionStorage|localStorage/);
  assert.doesNotMatch(html,/id="users-issued"|users-copy-all|users-show-issued/);
  assert.match(html,/Aktywne kody możesz ponownie otworzyć/);
});
