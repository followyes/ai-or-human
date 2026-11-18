import { createClient } from 'supabase';
import { DomainError } from './auth02-core.mjs';

function readEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new DomainError(`MISSING_${key}`,500);
  return value;
}
export const config = () => ({
  url:readEnv('SUPABASE_URL'),
  anonKey:readEnv('SUPABASE_ANON_KEY'),
  serviceKey:readEnv('SUPABASE_SERVICE_ROLE_KEY'),
  // AUTH-05 game APIs have no dependency on invitation-code HMAC secrets.
  // AUTH-02 callers still check >=32 bytes before any HMAC operation.
  hmacSecret:Deno.env.get('AUTH02_HMAC_SECRET') || ''
});
export function serviceClient() {
  const c=config();
  return createClient(c.url,c.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function rpc(supabase: ReturnType<typeof serviceClient>, name:string,args:Record<string,unknown>) {
  const {data,error}=await supabase.rpc(name,args);
  if (error) throw new DomainError('DATABASE_OPERATION_FAILED',503);
  return data;
}
export async function ensureUser(req:Request) {
  const bearer=req.headers.get('authorization') || '';
  if (!/^Bearer\s+eyJ[A-Za-z0-9._-]+$/.test(bearer)) throw new DomainError('LOGIN_REQUIRED',401);
  const jwt=bearer.replace(/^Bearer\s+/,'');
  const c=config();
  const scoped=createClient(c.url,c.anonKey,{
    global:{headers:{Authorization:`Bearer ${jwt}`}},
    auth:{persistSession:false,autoRefreshToken:false}
  });
  // Validates the JWT against Supabase Auth, not just untrusted user data.
  const {data:userResponse,error:authError}=await scoped.auth.getUser(jwt);
  if (authError || !userResponse?.user?.id) throw new DomainError('LOGIN_REQUIRED',401);
  return { userId:userResponse.user.id, scoped };
}
export async function ensureAdmin(req:Request) {
  const {userId,scoped}=await ensureUser(req);
  const {data:isAdmin,error:roleError}=await scoped.rpc('is_current_user_admin');
  if (roleError || isAdmin!==true) throw new DomainError('ADMIN_FORBIDDEN',403);
  return userId;
}
