import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  PlayerAuthService, PlayerAuthError, normalizeActivationCode,
  validatePlayerName, validatePlayerPassword, parsePlayerAuthHash,
  PLAYER_AUTH_STORAGE_KEY, REGISTRATION_RETRY_STORAGE_KEY
} from '../js/player-auth.js';

const root = join(dirname(fileURLToPath(import.meta.url)),'..');
const config = {projectUrl:'https://example.supabase.co',publishableKey:'sb_publishable_TEST_ABCDEFGHIJKLMNOPQRSTUVWXYZ'};
const code = 'AOH-ABCDEFGH-JKLMNPQR-STUVWXYZ-23456789';
const userId = '11111111-1111-4111-8111-111111111111';
const account = {id:userId,email:'someone@example.com'};
const validSession = {
  access_token:'test-player-access',refresh_token:'test-player-refresh',
  expires_at:9999999999,user:account
};
const memory = () => {
  const data = new Map();
  return {
    getItem:k => data.get(k) ?? null,
    setItem:(k,v) => data.set(k,String(v)),
    removeItem:k => data.delete(k),
    entries:()=>[...data.entries()]
  };
};
const json = (data,status=200) => new Response(JSON.stringify(data),{
  status, headers:{'content-type':'application/json'}
});
const service = (fetchImpl,storage=memory(),retryStorage=memory(),options={}) =>
  new PlayerAuthService({config,fetchImpl,storage,retryStorage,...options});

test('AUTH-04 invitation fragment only prefills form, never redeems the code',()=>{
  assert.equal(parsePlayerAuthHash('#register='+encodeURIComponent(code)).code, code);
  assert.equal(parsePlayerAuthHash('#register='+encodeURIComponent(code)).kind, 'register');
  assert.equal(parsePlayerAuthHash('#just-a-normal-fragment').kind, 'none');
  assert.equal(normalizeActivationCode(code.toLowerCase()),code);
  assert.equal(normalizeActivationCode(code.replaceAll('-','')),code);
  assert.throws(()=>normalizeActivationCode('AOH-nope'),e=>e.code==='INVALID_CODE');
  assert.throws(()=>validatePlayerName('two words'),e=>e.code==='INVALID_PLAYER_NAME');
  assert.equal(validatePlayerName('Pixel_Fox-3'),'Pixel_Fox-3');
  assert.throws(()=>validatePlayerPassword('short'),e=>e.code==='PASSWORD_REQUIREMENTS');
});

test('AUTH-04 registration retries same UUID after lost response; never stores raw code/email/password',async()=>{
  let attempts=0;
  const bodies=[];
  const stored=memory(),retry=memory();
  const api=service(async(url,req)=>{
    assert.match(String(url),/\/functions\/v1\/auth02-register$/);
    assert.equal(req.headers.apikey,config.publishableKey);
    assert.equal(req.headers.Authorization,undefined);
    bodies.push(JSON.parse(req.body));
    if (++attempts === 1) throw new TypeError('connection lost');
    return json({status:'registered_active'},201);
  },stored,retry);
  const input={code,email:'SOMEONE@example.com',password:'good-password-for-test',playerName:'Pixel_Fox'};
  await assert.rejects(api.register(input),e=>e instanceof PlayerAuthError && e.code==='NETWORK');
  const pending=retry.getItem(REGISTRATION_RETRY_STORAGE_KEY);
  assert.ok(pending);
  assert.ok(!pending.includes(code));
  assert.ok(!pending.includes('SOMEONE@example.com'));
  assert.ok(!pending.includes(input.password));
  assert.match(JSON.parse(pending).digest,/^[0-9a-f]{64}$/);
  const finished=await api.register(input);
  assert.equal(finished.status,'registered_active');
  assert.equal(bodies[0].request_key,bodies[1].request_key);
  assert.equal(bodies[0].player_name,input.playerName);
  assert.equal(bodies[0].email,'someone@example.com');
  assert.equal(bodies[1].code,code);
  assert.equal(retry.getItem(REGISTRATION_RETRY_STORAGE_KEY),null);
  assert.equal(stored.getItem(PLAYER_AUTH_STORAGE_KEY),null);
});

test('AUTH-04 register rejects bad input without a server call and does not use Supabase public signup',async()=>{
  let count=0;
  const api=service(async()=>{ count++;return json({status:'already_completed'}); });
  await assert.rejects(api.register({code:'bad',email:'a@example.com',playerName:'X',password:'sufficient-password'}),e=>e.code==='INVALID_CODE');
  await assert.rejects(api.register({code,email:'not-email',playerName:'X',password:'sufficient-password'}),e=>e.code==='INVALID_EMAIL');
  assert.equal(count,0);
  const source=readFileSync(join(root,'js/player-auth.js'),'utf8');
  assert.doesNotMatch(source,/\/auth\/v1\/signup/);
  assert.doesNotMatch(source,/service_role|sb_secret_|SUPABASE_SERVICE_ROLE_KEY/);
});

test('AUTH-04 login verifies session, loads own profile and logout removes browser session',async()=>{
  const calls=[];
  const stored=memory();
  const api=service(async(url,req)=>{
    const u=new URL(url);
    calls.push({path:u.pathname,headers:req.headers,method:req.method});
    if (u.pathname.endsWith('/token')) return json(validSession);
    if (u.pathname.endsWith('/auth/v1/user')) return json(account);
    if (u.pathname.endsWith('/player_accounts')) {
      assert.match(u.search,/user_id=eq\./);
      assert.equal(req.headers.Authorization,'Bearer '+validSession.access_token);
      return json([{player_name:'Pixel_Fox',status:'active'}]);
    }
    if (u.pathname.endsWith('/logout')) return new Response(null,{status:204});
    throw new Error('unexpected '+u.pathname);
  },stored);
  await api.signIn({email:'SOMEONE@example.com',password:'good-password-for-test'});
  const loaded=await api.currentAccount();
  assert.equal(loaded.profile.player_name,'Pixel_Fox');
  assert.equal(loaded.user.id,userId);
  assert.ok(stored.getItem(PLAYER_AUTH_STORAGE_KEY)?.includes('refresh_token'));
  await api.signOut();
  assert.equal(stored.getItem(PLAYER_AUTH_STORAGE_KEY),null);
  assert.equal(await api.currentAccount(),null);
  assert.ok(calls.some(c=>c.path.endsWith('/logout')));
});

test('AUTH-04 concurrent account reads share one refresh operation',async()=>{
  let refreshCalls=0;
  const stored=memory();
  stored.setItem(PLAYER_AUTH_STORAGE_KEY,JSON.stringify({...validSession,expires_at:1}));
  const api=service(async(url)=>{
    const u=new URL(url);
    if (u.pathname.endsWith('/token')) {
      refreshCalls++;
      await new Promise(resolve=>setTimeout(resolve,10));
      return json(validSession);
    }
    if (u.pathname.endsWith('/user')) return json(account);
    if (u.pathname.endsWith('/player_accounts')) return json([{player_name:'Pixel_Fox',status:'active'}]);
    throw new Error('unexpected '+u.pathname);
  },stored);
  const result=await Promise.all([api.currentAccount(),api.currentAccount()]);
  assert.equal(refreshCalls,1);
  assert.equal(result[0].user.id,result[1].user.id);
});

test('AUTH-04A code-only flow never triggers SMTP/recovery endpoints or accepts URL tokens',()=>{
  assert.equal(parsePlayerAuthHash('#access_token=x&refresh_token=y&type=recovery').kind,'unsupported');
  assert.equal(parsePlayerAuthHash('#access_token=x&refresh_token=y&type=signup').kind,'unsupported');
  const source=readFileSync(join(root,'js/player-auth.js'),'utf8');
  const ui=readFileSync(join(root,'js/player-auth-ui.js'),'utf8');
  const register=readFileSync(join(root,'supabase/functions/auth02-register/index.ts'),'utf8');
  assert.doesNotMatch(source,/\/auth\/v1\/(recover|resend)/);
  assert.doesNotMatch(ui,/requestPasswordReset|resendSignupConfirmation|acceptCallback/);
  assert.match(register,/email_confirm:true/);
  assert.match(register,/auth02_email_ownership_unverified:true/);
  assert.doesNotMatch(register,/auth\.admin\.inviteUserByEmail/);
});

test('AUTH-04 public UI is additive, linked, accessible, and Admin revoked-code list hides revoked codes',()=>{
  const html=readFileSync(join(root,'index.html'),'utf8');
  const css=readFileSync(join(root,'css/style.css'),'utf8');
  const admin=readFileSync(join(root,'js/admin-users-ui.js'),'utf8');
  const adminHtml=readFileSync(join(root,'admin/index.html'),'utf8');
  assert.match(html,/id="account-dialog"[^>]+role="dialog"[^>]+aria-modal="true"/);
  assert.match(html,/player-auth-ui\.js\?v=auth-04a/);
  assert.match(html,/data-account-panel="register"/);
  assert.doesNotMatch(html,/data-account-panel="(update|forgot|resend|confirm)"/);
  assert.match(html,/Na razie nie ma odzyskiwania hasła/);
  assert.doesNotMatch(html,/Wyślij e-mail potwierdzający|Nie pamiętasz hasła/);
  assert.match(css,/\.account-dialog-backdrop\[hidden\]/);
  assert.match(admin, /row\.status !== 'revoked'/);
  assert.match(admin,/Kod skopiowany!/);
  assert.match(adminHtml,/id="users-toast"[^>]+aria-live="polite"/);
  assert.doesNotMatch(adminHtml,/value="revoked">Unieważnione/);
  assert.equal((adminHtml.match(/data-users-choice/g) || []).length,4);
});
