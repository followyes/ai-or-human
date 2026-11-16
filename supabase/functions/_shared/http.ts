import { DomainError } from './auth02-core.mjs';

const DEFAULT_ALLOWED_ORIGIN = 'https://followyes.github.io';
export function allowedOrigin(origin: string | null): string | null {
  const configured = (Deno.env.get('AUTH02_ALLOWED_ORIGIN') || DEFAULT_ALLOWED_ORIGIN)
    .split(',').map(v => v.trim()).filter(Boolean);
  if (!origin) return null; // CLI/curl requests do not rely on CORS for security
  return configured.includes(origin) ? origin : null;
}
export function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(origin) || 'null',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };
}
export function respond(origin: string | null, status: number, body: unknown): Response {
  return Response.json(body,{status,headers:corsHeaders(origin)});
}
export function methodAndOrigin(req: Request): Response | null {
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigin(origin)) return respond(origin,403,{error:'ORIGIN_DENIED'});
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders(origin)});
  if (req.method!=='POST') return respond(origin,405,{error:'METHOD_NOT_ALLOWED'});
  const type = req.headers.get('content-type') || '';
  if (!type.startsWith('application/json')) return respond(origin,415,{error:'JSON_REQUIRED'});
  const length = Number(req.headers.get('content-length') || 0);
  if (length > 8192) return respond(origin,413,{error:'REQUEST_TOO_LARGE'});
  return null;
}
export async function readJson(req: Request): Promise<Record<string,unknown>> {
  const body = await req.text();
  if (body.length>8192) throw new DomainError('REQUEST_TOO_LARGE',413);
  let value: unknown;
  try { value=JSON.parse(body); } catch { throw new DomainError('INVALID_JSON'); }
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new DomainError('INVALID_JSON');
  return value as Record<string,unknown>;
}
export function handleError(origin: string | null, error: unknown): Response {
  if (error instanceof DomainError) return respond(origin,error.status,{error:error.code});
  // No DB errors, stack traces, e-mails, tokens or passwords returned to callers.
  return respond(origin,500,{error:'INTERNAL_ERROR'});
}
