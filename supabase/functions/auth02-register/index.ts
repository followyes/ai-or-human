import { config, rpc, serviceClient } from '../_shared/db.ts';
import { methodAndOrigin, readJson, respond, handleError } from '../_shared/http.ts';
import { DomainError, hmacHex, normalizeEmail, registerWithCode } from '../_shared/auth02-core.mjs';

// Public endpoint, but creating users is NEVER public Auth signup: the server
// validates the high-entropy, expiring, single-use capability in PostgreSQL.
// No passwords or codes are logged. AUTH-04 will supply the registration UI.
Deno.serve(async (req:Request): Promise<Response> => {
  const origin=req.headers.get('origin');
  const rejected=methodAndOrigin(req);
  if (rejected) return rejected;
  try {
    const body=await readJson(req);
    const c=config();
    if (c.hmacSecret.length<32) throw new DomainError('HMAC_SECRET_MISSING',500);
    const admin=serviceClient();
    // Best-effort infrastructure fingerprint: never trust browser-supplied IDs
    // as authentication. Strong 160-bit codes remain the primary defense.
    const remote=req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const fingerprint=await hmacHex(c.hmacSecret,`limit:register:${remote}`);
    const allowed=await rpc(admin,'auth02_rate_gate',{
      p_rate_key:fingerprint,p_max_attempts:12,p_window_seconds:900
    });
    if (allowed!==true) throw new DomainError('TOO_MANY_REQUESTS',429);
    // Secondary shared circuit breaker limits total backend work even if an
    // upstream proxy forwards spoofable client-IP headers.
    const globalKey=await hmacHex(c.hmacSecret,'limit:register:global');
    const globalAllowed=await rpc(admin,'auth02_rate_gate',{
      p_rate_key:globalKey,p_max_attempts:300,p_window_seconds:900
    });
    if (globalAllowed!==true) throw new DomainError('TOO_MANY_REQUESTS',429);

    const input={...body};
    // Avoid repeating a high-privileged operation after email collision or
    // unknown createUser response: those attempts remain reserved/review.
    const adapter={
      hmac: (message:string) => hmacHex(c.hmacSecret,message),
      reserve: ({codeDigest,emailDigest,playerName,requestKey}:{codeDigest:string,emailDigest:string,playerName:string,requestKey:string}) =>
        rpc(admin,'auth02_reserve_code',{p_digest:codeDigest,p_email_digest:emailDigest,p_player_name:playerName,p_request_key:requestKey}),
      begin:(id:string) => rpc(admin,'auth02_begin_creation',{p_attempt_id:id}),
      createAuthUser:async ({email,password,playerName,attemptId,codeId}:{email:string,password:string,playerName:string,attemptId:string,codeId:string})=>{
        const {data,error}=await admin.auth.admin.createUser({
          email:normalizeEmail(email),password,email_confirm:false,
          app_metadata:{auth02_attempt_id:attemptId,auth02_code_id:codeId,auth02_player_name:playerName}
        });
        if (error || !data?.user?.id) throw new Error('AUTH_CREATE_FAILED');
        return data.user.id;
      },
      markCreated:(id:string,userId:string)=>rpc(admin,'auth02_mark_auth_created',{p_attempt_id:id,p_auth_user_id:userId}),
      commit:(id:string,userId:string)=>rpc(admin,'auth02_commit_registration',{p_attempt_id:id,p_auth_user_id:userId}),
      flagReview:(id:string,reason:string)=>rpc(admin,'auth02_flag_review',{p_attempt_id:id,p_error_code:reason})
    };
    const result=await registerWithCode(input,adapter);
    return respond(origin,result.status==='already_completed'?200:201,result);
  } catch (error) {
    return handleError(origin,error);
  }
});
