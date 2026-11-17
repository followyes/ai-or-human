import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {
  adminUsersRequest, listIssuedCodes, issueCodes, revokeIssuedCode,
  listPlayerAccounts, changePlayerStatus, AdminUsersError
} from '../js/admin-users.js';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(join(root,'admin/index.html'),'utf8');
const adminJs=readFileSync(join(root,'admin/admin.js'),'utf8');
const edge=readFileSync(join(root,'supabase/functions/auth02-admin/index.ts'),'utf8');
const migrationFile=join(root,'..','OUTSIDE_REPO','SQL','AUTH_03_ADMIN_ACCOUNTS.sql');
const migration=existsSync(migrationFile) ? readFileSync(migrationFile,'utf8') : null;
const cfg={projectUrl:'https://test-project.supabase.co',publishableKey:'sb_publishable_ABCDEFGHIJKLMNOP'};
const session={access_token:'fake-user-jwt'};
const uuid='11111111-1111-4111-8111-111111111111';
const mk = (value,code=200)=>async (url,request) => {
 assert.match(String(url),/\/functions\/v1\/auth02-admin$/);
 assert.equal(request.method,'POST');
 assert.equal(request.headers.Authorization,'Bearer fake-user-jwt');
 assert.equal(request.headers.apikey,cfg.publishableKey);
 assert.equal(request.headers['Content-Type'],'application/json');
 return {ok:code>=200 && code<300,status:code,json:async()=>value};
};
const opt=(response,status=200)=>({session,config:cfg,fetchImpl:mk(response,status)});

test('Admin Users has four tabs and a single tabpanel',()=> {
 assert.match(html,/id="tab-users"[^>]+aria-controls="users-workspace"/);
 assert.match(html,/id="users-workspace"[^>]+aria-labelledby="tab-users"[^>]+hidden inert/);
 assert.match(adminJs,/usersPanel\.setActive\(tab === "users"\)/);
 assert.match(adminJs,/usersPanel\.clear\(\)/);
 assert.match(adminJs,/if \(uploadBusy \|\| deleteBusy .* usersPanel\.busy\)/);
});
test('No raw codes in static HTML or browser persisted storage',()=> {
 assert.doesNotMatch(html,/AOH-[A-Z23456789]{8}-/);
 assert.doesNotMatch(readFileSync(join(root,'js/admin-users-ui.js'),'utf8'),/localStorage|sessionStorage/);
 assert.match(html,/Kody aktywacyjne/);
});
test('Issue form validates both bounds before any request',async()=> {
 for (const [c,d] of [[0,7],[26,7],[1,0],[1,91],[1.5,7]]) {
  await assert.rejects(issueCodes(c,d,opt({})),e=>e instanceof AdminUsersError && e.code==='INVALID_BATCH');
 }
});
test('Raw codes are returned only from issuance, not history',async()=> {
 const issued=[{id:uuid,code:'AOH-ABCDEFGH-JKLMNPQR-STUVWXYZ-23456789',link:'https://example.org/#register=abc'}];
 const result=await issueCodes(1,7,opt({codes:issued}));
 assert.deepEqual(result.codes,issued);
 const listed=await listIssuedCodes(opt({codes:[{id:uuid,code_hint:'6789',status:'available'}]}));
 assert.equal(listed[0].code,undefined);
});
test('Revoke requires UUID; server confirms success',async()=> {
 await assert.rejects(revokeIssuedCode('junk',opt({revoked:true})),/Nieprawidłowy identyfikator/);
 assert.equal(await revokeIssuedCode(uuid,opt({revoked:true})),true);
 await assert.rejects(revokeIssuedCode(uuid,opt({revoked:false})),/Nie potwierdzono/);
});
test('Accounts are paginated and filtered server-side',async()=> {
 let payload;
 const fetchImpl=async (_,request)=>{
  payload=JSON.parse(request.body);
  return {ok:true,status:200,json:async()=>({accounts:[{user_id:uuid,player_name:'PixelFox',status:'active'}],total:1})};
 };
 const result=await listPlayerAccounts(50,{search:'Pix',status:'active'},{session,config:cfg,fetchImpl});
 assert.deepEqual(payload,{action:'users',limit:50,offset:50,search:'Pix',status:'active'});
 assert.equal(result.total,1);
});
test('Account status requires server-confirmed result',async()=> {
 assert.equal((await changePlayerStatus(uuid,'blocked',opt({account:{user_id:uuid,status:'blocked'}}))).status,'blocked');
 await assert.rejects(changePlayerStatus(uuid,'admin',opt({})),/Nieprawidłowy status/);
 await assert.rejects(changePlayerStatus(uuid,'blocked',opt({account:{user_id:uuid,status:'active'}})),/Nie można potwierdzić/);
});
test('401 and 403 guard; protected admin account error is distinct',async()=> {
 await assert.rejects(adminUsersRequest('list',{},opt({error:'ADMIN_LOGIN_REQUIRED'},401)),e=>e.code==='SESSION');
 await assert.rejects(adminUsersRequest('list',{},opt({error:'ADMIN_FORBIDDEN'},403)),e=>e.code==='SESSION');
 await assert.rejects(adminUsersRequest('set_user_status',{},opt({error:'ADMIN_ACCOUNT_PROTECTED'},403)),e=>e.code==='ADMIN_ACCOUNT_PROTECTED');
});
test('AUTH-03 SQL: service-only RPCs, hardened admin role, no destructive statements',
  {skip: migration === null ? 'SQL distributed outside public REPO; validate it separately in release package' : false},()=> {
 assert.match(migration,/SECURITY DEFINER SET search_path = ''/);
 assert.match(migration,/FROM private\.admin_users a WHERE a\.user_id = p_actor AND a\.is_active = true/);
 assert.match(migration,/FROM private\.admin_users a WHERE a\.user_id = p_user_id/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.auth03_set_player_status\(uuid,uuid,text\) TO service_role/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.auth03_list_players\(uuid,integer,integer,text,text\) FROM PUBLIC, anon, authenticated/);
 assert.doesNotMatch(migration,/\b(?:DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE)\b/i);
});
test('AUTH-03 Edge: JWT/admin check and no supplied actor ID',()=> {
 assert.match(edge,/const actor=await ensureAdmin\(req\)/);
 assert.match(edge,/case 'users':/);
 assert.match(edge,/case 'set_user_status':/);
 assert.match(edge,/p_actor: actor/);
 assert.match(edge,/userId === actor/);
 assert.doesNotMatch(edge,/p_actor:\s*body\./);
});
