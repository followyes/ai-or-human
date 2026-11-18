import { ensureUser, ensureAdmin, serviceClient } from '../_shared/db.ts';
import { methodAndOrigin, readJson, respond, handleError } from '../_shared/http.ts';
import { DomainError } from '../_shared/auth02-core.mjs';
import {
  PRIVATE_BUCKET, SIGNED_URL_TTL_SECONDS, uuid, startRequest,
  answerRequest, pageRequest, publicCard, cleanError
} from '../_shared/auth05-contract.mjs';

// AUTH-05B: isolated, additive API. The public legacy game is not wired to it.
// Each player call verifies a real Supabase Auth user and every SQL operation
// checks the current account status again while holding its game row lock.
// Service-role credentials never leave this Edge Function.
Deno.serve(async (req:Request): Promise<Response> => {
  const origin=req.headers.get('origin');
  const rejected=methodAndOrigin(req);
  if (rejected) return rejected;
  try {
    const body=await readJson(req);
    if (typeof body.action!=='string') throw new DomainError('UNKNOWN_ACTION');

    // Explicit administrator-only staging and reporting paths. Never infer
    // Admin role from a player account name or user_metadata.
    if (body.action==='stage_asset') {
      const actor=await ensureAdmin(req);
      const imageId=uuid(body.image_id);
      const db=serviceClient();
      const prepared=await call(db,'auth05_prepare_asset',{
        p_actor:actor,p_image_id:imageId
      });
      if (prepared.status==='ready') return respond(origin,200,{status:'ready'});
      const capacity=await call(db,'auth05_asset_copy_budget',{
        p_actor:actor,p_image_id:imageId
      });
      if (!capacity.allowed) throw new DomainError('PRIVATE_ASSET_CAPACITY_EXCEEDED',409);

      // The target path is a stable random UUID, NOT an image ID, class or
      // old public filename. Resume never generates a second target path.
      const {error:copyError}=await db.storage.from('game-images')
        .copy(prepared.source_path,prepared.private_path,{destinationBucket:PRIVATE_BUCKET});
      if (copyError) {
        // A previous ambiguous response may have completed the copy. Do not
        // overwrite; verify it exists in the exact reserved target instead.
        const {data:already,error:lookupError}=await db.storage
          .from(PRIVATE_BUCKET).info(prepared.private_path);
        if (lookupError || !already) throw new DomainError('PRIVATE_ASSET_COPY_FAILED',503);
      }
      await call(db,'auth05_commit_asset',{
        p_actor:actor,p_image_id:imageId,p_expected_path:prepared.private_path
      });
      return respond(origin,200,{status:'ready'});
    }
    if (body.action==='admin_results') {
      const actor=await ensureAdmin(req);
      const {limit,offset}=pageRequest(body);
      const data=await call(serviceClient(),'auth05_admin_results',{
        p_actor:actor,p_limit:limit,p_offset:offset
      });
      return respond(origin,200,data);
    }

    const {userId}=await ensureUser(req);
    const db=serviceClient();
    switch(body.action) {
      case 'start': {
        const setup=startRequest(body);
        const result=await call(db,'auth05_begin_game',{
          p_actor:userId,p_request_key:setup.requestKey,p_mode:setup.mode,
          p_classic_size:setup.cards,p_difficulty:setup.difficulty
        });
        return respond(origin,201,result);
      }
      case 'card': {
        const gameId=uuid(body.game_id);
        const card=await call(db,'auth05_get_card',{
          p_actor:userId,p_game_id:gameId
        });
        return respond(origin,200,await deliverCard(db,card));
      }
      case 'replace_card': {
        const card=await call(db,'auth05_replace_unrevealed_card',{
          p_actor:userId,p_game_id:uuid(body.game_id),p_card_id:uuid(body.card_id)
        });
        return respond(origin,200,await deliverCard(db,card));
      }
      case 'reveal': {
        const result=await call(db,'auth05_reveal_card',{
          p_actor:userId,p_game_id:uuid(body.game_id),p_card_id:uuid(body.card_id)
        });
        return respond(origin,200,result);
      }
      case 'answer': {
        const item=answerRequest(body);
        const result=await call(db,'auth05_answer_card',{
          p_actor:userId,p_game_id:item.gameId,p_card_id:item.cardId,p_choice:item.choice
        });
        return respond(origin,200,result);
      }
      case 'my_results': {
        const {limit,offset}=pageRequest(body);
        const result=await call(db,'auth05_my_results',{
          p_actor:userId,p_limit:limit,p_offset:offset
        });
        return respond(origin,200,result);
      }
      default: throw new DomainError('UNKNOWN_ACTION');
    }
  } catch(error) { return handleError(origin,error); }
});

async function call(db:ReturnType<typeof serviceClient>,name:string,args:Record<string,unknown>) {
  const {data,error}=await db.rpc(name,args);
  if (error) throw cleanError(error);
  return data;
}

async function deliverCard(db:ReturnType<typeof serviceClient>,card:Record<string,unknown>) {
  const {data:signed,error:signError}=await db.storage.from(PRIVATE_BUCKET)
    .createSignedUrl(String(card.private_path),SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl)
    throw new DomainError('PRIVATE_ASSET_UNAVAILABLE',503);
  return publicCard(card,signed.signedUrl);
}
