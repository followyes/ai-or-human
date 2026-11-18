import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  startRequest,answerRequest,pageRequest,publicCard,cleanError,
  PRIVATE_BUCKET,SIGNED_URL_TTL_SECONDS
} from '../supabase/functions/_shared/auth05-contract.mjs';

const exampleId='e9a43e55-a141-4fd8-a2bd-846284441881';
const otherId='d5d2b8aa-3af3-4df5-b5c7-ae2c658bfbba';
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const edge=read('../supabase/functions/auth05-game/index.ts');

test('Classic and Speed Run accepts only supported setup; request key is reusable',()=>{
  assert.deepEqual(startRequest({request_key:exampleId,mode:'classic',cards:20}),{
    requestKey:exampleId,mode:'classic',cards:20,difficulty:null
  });
  assert.deepEqual(startRequest({request_key:exampleId,mode:'speed-run',difficulty:'hard'}),{
    requestKey:exampleId,mode:'speed-run',cards:null,difficulty:'hard'
  });
  for(const body of [
    {mode:'classic',cards:10},{mode:'classic',cards:50,difficulty:'easy'},
    {mode:'speed-run',difficulty:'ultra'}, {mode:'speed-run',difficulty:'easy',cards:20}
  ]) assert.throws(()=>startRequest({...body,request_key:exampleId}));
});

test('Answer contract accepts only classified choices or timeout with UUID identities',()=>{
  assert.deepEqual(answerRequest({game_id:exampleId,card_id:otherId,choice:'human'}),{
    gameId:exampleId,cardId:otherId,choice:'human'
  });
  assert.throws(()=>answerRequest({game_id:exampleId,card_id:otherId,choice:'wrong'}));
  assert.throws(()=>answerRequest({game_id:'x',card_id:otherId,choice:'ai'}));
});

test('History pagination is bounded',()=>{
  assert.deepEqual(pageRequest({}),{limit:20,offset:0});
  for(const body of [{limit:101},{limit:0},{limit:4.2},{offset:-1},{offset:100001}])
    assert.throws(()=>pageRequest(body));
});

test('Player card response strictly removes path, class and image ID',()=>{
  const card=publicCard({card_id:exampleId,ordinal:1,content_class:'ai',
    image_id:otherId,private_path:'cards/private.avif',secret:'should-not-leak'},
    'https://example.supabase.co/storage/v1/object/sign/game-images-private/cards/neutral.avif?token=ok');
  assert.deepEqual(Object.keys(card),['card_id','ordinal','image_url','url_expires_in_seconds']);
  assert.equal(card.url_expires_in_seconds,SIGNED_URL_TTL_SECONDS);
  assert.equal(PRIVATE_BUCKET,'game-images-private');
  assert.doesNotMatch(JSON.stringify(card),/should-not-leak|content_class|image_id|private_path/);
});

test('Postgres exceptions never return raw database details',()=>{
  assert.equal(cleanError({code:'42501',message:'raw rows'}).status,403);
  assert.equal(cleanError({code:'P0002',message:'raw rows'}).status,404);
  assert.equal(cleanError({code:'XX000',message:'select * from auth.users'}).code,'GAME_DATABASE_UNAVAILABLE');
});

test('Edge checks real Auth, does not return internal asset fields or legacy results',()=>{
  for(const name of ['auth05_begin_game','auth05_get_card','auth05_reveal_card',
    'auth05_replace_unrevealed_card','auth05_answer_card','auth05_my_results','auth05_admin_results',
    'auth05_prepare_asset','auth05_asset_copy_budget','auth05_commit_asset'])
    assert.match(edge,new RegExp(name));
  assert.match(edge,/ensureUser\(req\)/);
  assert.match(edge,/ensureAdmin\(req\)/);
  assert.match(edge,/publicCard\(card,signed\.signedUrl\)/);
  assert.doesNotMatch(edge,/respond\(origin,200,card\)/);
  assert.doesNotMatch(edge,/game-results\.js|browser_id|player_id|content_class/);
  assert.match(read('../supabase/config.toml'),/\[functions\.auth05-game\]\s*verify_jwt = true/);
});
