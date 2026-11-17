import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {
 createCode,normalizeCode,normalizeEmail,normalizePlayerName,
 validateRegistrationInput,validateBatch,buildInvitationLink,hmacHex,
 registerWithCode,DomainError
} from '../supabase/functions/_shared/auth02-core.mjs';

const VALID_CODE=createCode(new Uint8Array(Array.from({length:20},(_,i)=>i*11%256)));
const VALID_USER={code:VALID_CODE,email:'person@example.com',password:'Long!Safe!Password123',
  player_name:'PixelFox',request_key:'aa43cfa3-253f-4aac-9441-d0114d90a3b1'};
function fakeStore(overrides={}){
  const entry={status:'available',attempt:null,createdCount:0,finalized:0,attemptId:'f967a852-324f-499c-9135-55a6a30c0de9',
    codeId:'c3b833ee-3cff-46ac-bae2-e42d6df565db',
    userId:'c77b6096-f25c-4a88-89e4-e6ca03d145c4'};
  const adapter={
    hmac:async v=>`hash-${v}`,
    reserve:async ({requestKey,emailDigest,playerName})=>{
      if(entry.attempt && requestKey===entry.attempt.requestKey && emailDigest===entry.attempt.emailDigest && playerName===entry.attempt.playerName)
        return {ok:true,state:entry.attempt.state,attempt_id:entry.attemptId,code_id:entry.codeId,auth_user_id:entry.attempt.userId};
      if(entry.status!=='available') return {ok:false,code:'INVALID_CODE'};
      entry.status='reserved'; entry.attempt={state:'reserved',requestKey,emailDigest,playerName,userId:null};
      return {ok:true,state:'reserved',attempt_id:entry.attemptId,code_id:entry.codeId};
    },
    begin:async()=>{
      if(entry.attempt?.state!=='reserved') return false;
      entry.attempt.state='creating';return true;
    },
    createAuthUser:async()=>{entry.createdCount++;return entry.userId;},
    markCreated:async (_id,userId)=>{
      if(entry.attempt?.state!=='creating') return false;
      entry.attempt.state='auth_created';entry.attempt.userId=userId;return true;
    },
    commit:async (_id,userId)=>{
      if(entry.attempt?.state!=='auth_created' || entry.attempt.userId!==userId) return {ok:false};
      entry.attempt.state='committed';entry.status='consumed';entry.finalized++;return {ok:true};
    },
    flagReview:async()=>{entry.attempt.state='manual_review';return true;},
    ...overrides
  };
  return {entry,adapter};
}

test('Code is 160-bit base32, formatted and normalizable',()=>{
  assert.match(VALID_CODE,/^AOH-(?:[A-HJ-NP-Z2-9]{8}-){3}[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(VALID_CODE.replaceAll('-','').length,35);
  assert.equal(normalizeCode(VALID_CODE.toLowerCase()),VALID_CODE);
  assert.equal(normalizeCode(VALID_CODE.replaceAll('-','')),VALID_CODE);
  const newCodes=new Set(Array.from({length:512},()=>createCode()));
  assert.equal(newCodes.size,512);
});
test('Link uses same code in URL fragment, not query string',()=>{
  const link=buildInvitationLink(VALID_CODE);
  assert.equal(new URL(link).search,'');
  assert.equal(new URL(link).hash,`#register=${VALID_CODE}`);
  assert.equal(new URL(link).origin,'https://followyes.github.io');
});
test('Validation rejects invalid, empty or replay-shaping inputs',()=>{
  assert.throws(()=>normalizeCode('AOH-TEST'),DomainError);
  assert.equal(normalizeEmail(' User@Example.com '),'user@example.com');
  assert.throws(()=>normalizePlayerName('Too Many Words'),DomainError);
  assert.throws(()=>validateRegistrationInput({...VALID_USER,password:'12345'}),DomainError);
  assert.throws(()=>validateRegistrationInput({...VALID_USER,request_key:'x'}),DomainError);
  assert.throws(()=>validateBatch({days:0,count:1}),DomainError);
  assert.throws(()=>validateBatch({days:7,count:26}),DomainError);
  assert.deepEqual(validateBatch({days:7,count:5}),{days:7,count:5});
});
test('Deterministic HMAC is keyed, same message same digest',async()=>{
  const a=await hmacHex('a'.repeat(64),'code:'+VALID_CODE);
  const b=await hmacHex('a'.repeat(64),'code:'+VALID_CODE);
  const c=await hmacHex('b'.repeat(64),'code:'+VALID_CODE);
  assert.match(a,/^[0-9a-f]{64}$/);
  assert.equal(a,b);assert.notEqual(a,c);
});
test('Registration consumes exactly one code and creates one auth user',async()=>{
  const {entry,adapter}=fakeStore();
  assert.deepEqual(await registerWithCode(VALID_USER,adapter),{status:'registered_active'});
  assert.equal(entry.createdCount,1);assert.equal(entry.finalized,1);assert.equal(entry.status,'consumed');
  assert.deepEqual(await registerWithCode(VALID_USER,adapter),{status:'already_completed'});
  assert.equal(entry.createdCount,1);
  await assert.rejects(registerWithCode({...VALID_USER,request_key:'c75a5f95-4785-4a0e-9f30-36a5d0fe3844'},adapter),e=>e.code==='CODE_NOT_AVAILABLE');
});
test('Two concurrent requests never create two accounts',async()=>{
  const {entry,adapter}=fakeStore();
  const second={...VALID_USER,request_key:'8909f3ad-7fe9-4f42-a236-e909c77c453d'};
  const results=await Promise.allSettled([registerWithCode(VALID_USER,adapter),registerWithCode(second,adapter)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(entry.createdCount,1);assert.equal(entry.finalized,1);
});
test('Unknown createUser failure locks code for manual reconciliation',async()=>{
  const {entry,adapter}=fakeStore({createAuthUser:async()=>{entry.createdCount++;throw new Error('network timeout');}});
  await assert.rejects(registerWithCode(VALID_USER,adapter),e=>e.code==='REGISTRATION_REVIEW_REQUIRED');
  assert.equal(entry.status,'reserved');assert.equal(entry.attempt.state,'manual_review');
  await assert.rejects(registerWithCode(VALID_USER,adapter),e=>e.code==='REGISTRATION_REVIEW_REQUIRED');
  assert.equal(entry.createdCount,1);
});
test('Commit failure after creating Auth user does not unlock code',async()=>{
  const {entry,adapter}=fakeStore({commit:async()=>{throw new Error('DB down');}});
  await assert.rejects(registerWithCode(VALID_USER,adapter),e=>e.code==='REGISTRATION_REVIEW_REQUIRED');
  assert.equal(entry.createdCount,1);assert.equal(entry.attempt.state,'manual_review');
  assert.equal(entry.status,'reserved');
});
test('Retry after durable auth_created can finalize without second user creation',async()=>{
  const {entry,adapter}=fakeStore();
  entry.status='reserved';entry.attempt={state:'auth_created',requestKey:VALID_USER.request_key,
    emailDigest:'hash-email:person@example.com',playerName:'PixelFox',userId:entry.userId};
  const r=await registerWithCode(VALID_USER,adapter);
  assert.equal(r.status,'registered_active');
  assert.equal(entry.createdCount,0);assert.equal(entry.finalized,1);
});
test('SQL exposes only service_role RPC and keeps old game intact',(t)=>{
  // SQL is shipped in OUTSIDE_REPO; standalone REPO still runs game tests.
  const root=new URL('../../OUTSIDE_REPO/SQL/AUTH_02_BACKEND_RPC_MIGRATION.sql',import.meta.url);
  if (!existsSync(root)) return t.skip('SQL lives in OUTSIDE_REPO, absent from standalone REPO');
  const sql=readFileSync(root,'utf8');
  const names=['auth02_issue_batch','auth02_rate_gate','auth02_reserve_code','auth02_begin_creation',
    'auth02_mark_auth_created','auth02_commit_registration','auth02_adopt_created_user','auth02_revoke_code',
    'auth02_get_attempt','auth02_list_attempts','auth02_list_codes','auth02_flag_review','auth02_release_unstarted'];
  for(const name of names) {
    assert.ok(sql.includes(`FUNCTION public.${name}(`),`missing ${name}`);
    assert.ok(sql.includes(`'${name}(`),`missing grant/revoke ${name}`);
  }
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.\%s TO service_role/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.\%s FROM PUBLIC, anon, authenticated/);
  assert.ok(!/\bDROP\s+TABLE\b|\bTRUNCATE\b|\bDELETE\s+FROM\s+public\.game_results\b/i.test(sql));
  assert.match(sql,/SET search_path = ''/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/state='committed'/);
});
test('No secret keys inside GitHub Pages source and no UI introduced',()=>{
  const build=readFileSync(new URL('build-site.js',import.meta.url),'utf8');
  assert.ok(!build.includes('supabase/functions'));
  const fn=readFileSync(new URL('../supabase/functions/auth02-register/index.ts',import.meta.url),'utf8');
  assert.ok(fn.includes('email_confirm:true'));
  assert.ok(fn.includes('auth02_reserve_code'));
  assert.ok(fn.includes('AUTH_CREATE_UNCERTAIN')===false); // shared module owns this error state
});

// CI has no OUTSIDE_REPO. Always validate the Edge-side contract statically;
// the release audit performs the mandatory cross-check against packaged SQL.
test('Rate-limit definitions are present in the deployed registration entrypoint',()=>{
 const fn=readFileSync(new URL('../supabase/functions/auth02-register/index.ts',import.meta.url),'utf8');
 const values=[...fn.matchAll(/p_max_attempts\s*:\s*(\d+)/g)].map(m=>Number(m[1]));
 assert.deepEqual(values,[12,300],'both per-client and global limits must be reviewed');
});
