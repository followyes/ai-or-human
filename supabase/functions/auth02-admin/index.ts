import { config, ensureAdmin, rpc, serviceClient } from '../_shared/db.ts';
import { methodAndOrigin, readJson, respond, handleError } from '../_shared/http.ts';
import {
  createCode, hmacHex, validateBatch, buildInvitationLink, DomainError, validateUuid
} from '../_shared/auth02-core.mjs';
import { encryptIssuedCode, decryptIssuedCode } from '../_shared/auth04-code-crypto.mjs';

// All actions require a real Admin JWT + a positive is_current_user_admin() RPC.
// AUTH-03 extends AUTH-02 admin operations; all requests verify Admin JWT and role.
Deno.serve(async (req:Request): Promise<Response> => {
  const origin=req.headers.get('origin');
  const rejected=methodAndOrigin(req);
  if (rejected) return rejected;
  try {
    const actor=await ensureAdmin(req);
    const body=await readJson(req);
    const c=config();
    if (c.hmacSecret.length<32) throw new DomainError('HMAC_SECRET_MISSING',500);
    const admin=serviceClient();
    switch(body.action) {
      case 'generate': {
        const {count,days}=validateBatch(body);
        const batchId=crypto.randomUUID();
        const plainCodes=Array.from({length:count},()=>createCode());
        // ALL envelopes are encrypted before the SQL batch transaction.
        // An old Edge issuer without envelopes fails closed after AUTH-04C SQL.
        const ids=plainCodes.map(()=>crypto.randomUUID());
        const keyHex=Deno.env.get('AUTH04_CODE_ENCRYPTION_KEY');
        const digests=await Promise.all(plainCodes.map(async (code,i)=>({
          ...(await encryptIssuedCode(code,ids[i],keyHex)),
          digest:await hmacHex(c.hmacSecret,`code:${code}`),hint:code.slice(-4)
        })));
        const created=await rpc(admin,'auth02_issue_batch',{
          p_admin_id:actor,p_batch_id:batchId,p_days:days,p_codes:digests
        });
        if (created?.count!==count ||
          !plainCodes.every((_,i)=>created.codes?.[i]?.id===ids[i])) {
          throw new DomainError('ISSUE_INTEGRITY_FAILED',503);
        }
        // A lost HTTP response is now recoverable through Admin-only reveal.
        return respond(origin,201,{
          batch_id:batchId,expires_at:created.expires_at,
          codes:plainCodes.map((code,i)=>({id:ids[i],code,link:buildInvitationLink(code)}))
        });
      }
      case 'list': {
        const limit=Number.isSafeInteger(body.limit)?Number(body.limit):100;
        return respond(origin,200,{codes:await rpc(admin,'auth02_list_codes',{p_limit:limit})});
      }
      case 'reveal': {
        const codeId=validateUuid(body.code_id);
        const envelope=await rpc(admin,'auth04_reveal_available_code',{p_code_id:codeId});
        if (!envelope) throw new DomainError('CODE_NOT_REVEALABLE',409);
        const decrypted=await decryptIssuedCode(
          envelope,Deno.env.get('AUTH04_CODE_ENCRYPTION_KEY'),c.hmacSecret
        );
        return respond(origin,200,{id:codeId,...decrypted});
      }
      case 'revoke': {
        const codeId=validateUuid(body.code_id);
        const revoked=await rpc(admin,'auth02_revoke_code',{p_code_id:codeId});
        if (!revoked) throw new DomainError('CODE_NOT_REVOCABLE',409);
        return respond(origin,200,{revoked:true});
      }
      case 'release_unstarted': {
        const attemptId=validateUuid(body.attempt_id);
        const released=await rpc(admin,'auth02_release_unstarted',{p_attempt_id:attemptId});
        if (!released) throw new DomainError('ATTEMPT_NOT_RELEASABLE',409);
        return respond(origin,200,{released:true});
      }
      case 'users': {
        const limit = body.limit === undefined ? 50 : body.limit;
        const offset = body.offset === undefined ? 0 : body.offset;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
            !Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
          throw new DomainError('INVALID_PAGINATION');
        const search = body.search === undefined ? '' : body.search;
        const status = body.status === undefined ? '' : body.status;
        if (typeof search !== 'string' || search.length > 80 ||
            (status !== '' && status !== 'active' && status !== 'blocked'))
          throw new DomainError('INVALID_ACCOUNT_FILTER');
        const result = await rpc(admin, 'auth03_list_players', {
          p_actor: actor, p_limit: limit, p_offset: offset,
          p_query: search, p_status: status
        });
        return respond(origin, 200, result);
      }
      case 'set_user_status': {
        const userId = validateUuid(body.user_id);
        if (body.status !== 'active' && body.status !== 'blocked')
          throw new DomainError('INVALID_ACCOUNT_STATUS');
        if (userId === actor) throw new DomainError('ADMIN_ACCOUNT_PROTECTED', 403);
        const result = await rpc(admin, 'auth03_set_player_status', {
          p_actor: actor, p_user_id: userId, p_status: body.status
        });
        if (!result?.user_id) throw new DomainError('ACCOUNT_NOT_FOUND', 404);
        return respond(origin, 200, { account: result });
      }
      case 'attempts': {
        const limit=Number.isSafeInteger(body.limit)?Number(body.limit):100;
        return respond(origin,200,{attempts:await rpc(admin,'auth02_list_attempts',{p_limit:limit})});
      }
      case 'reconcile': {
        // Explicit manual recovery: an Admin supplies a known Auth user ID from
        // Authentication > Users. No blind deletion or code reissue is possible.
        const attemptId=validateUuid(body.attempt_id);
        const userId=validateUuid(body.auth_user_id);
        const attempt=await rpc(admin,'auth02_get_attempt',{p_attempt_id:attemptId});
        if (!attempt?.id) throw new DomainError('ATTEMPT_NOT_FOUND',404);
        const {data,error}=await admin.auth.admin.getUserById(userId);
        if (error || !data?.user) throw new DomainError('AUTH_USER_NOT_FOUND',404);
        const user=data.user;
        if (user.app_metadata?.auth02_attempt_id!==attemptId ||
          user.app_metadata?.auth02_code_id!==attempt.code_id ||
          user.app_metadata?.auth02_player_name!==attempt.player_name ||
          await hmacHex(c.hmacSecret,`email:${user.email?.trim().toLowerCase()||''}`)!==attempt.email_digest) {
          throw new DomainError('RECONCILIATION_MISMATCH',409);
        }
        if (attempt.state==='committed' && attempt.auth_user_id===userId)
          return respond(origin,200,{status:'already_completed'});
        if (attempt.state!=='auth_created') {
          const adopted=await rpc(admin,'auth02_adopt_created_user',{p_attempt_id:attemptId,p_auth_user_id:userId});
          if (!adopted) throw new DomainError('RECONCILIATION_STATE_INVALID',409);
        }
        const committed=await rpc(admin,'auth02_commit_registration',{p_attempt_id:attemptId,p_auth_user_id:userId});
        if (!committed?.ok) throw new DomainError('RECONCILIATION_REVIEW_REQUIRED',409);
        return respond(origin,200,{status:'committed'});
      }
      default: throw new DomainError('UNKNOWN_ACTION');
    }
  } catch(error) {return handleError(origin,error);}
});
