/* eslint-disable @typescript-eslint/no-explicit-any -- Execute real voice modules with isolated provider/browser dependencies. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function compile(path: string, deps: Record<string, any> = {}, globals: Record<string, any> = {}) {
 const compiled={exports:{} as any};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',...Object.keys(globals),code)((id:string)=>deps[id]??require(id),compiled.exports,...Object.values(globals));return compiled.exports;
}
const contract=compile('lib/noa/noa-voice-provider.ts');
const config=compile('lib/ai/provider-config.ts');
const health=compile('lib/ai/provider-health.server.ts',{'server-only':{},'./provider-config':config});
const available={authStatus:'valid',reachability:'available',quotaStatus:'unknown'};
function server(options:{env?:any;fetch?:any;health?:any;timeout?:boolean}={}) {
 const calls:any[]=[]; const env=options.env??{OPENAI_API_KEY:'test-openai-secret',GEMINI_API_KEY:'test-gemini-secret'};
 const api=compile('lib/noa/noa-voice-provider.server.ts',{'server-only':{},'./noa-voice-provider':contract,'@/lib/ai/provider-health.server':{...health,checkProviderHealth:options.health??(async()=>available)}},{process:{env},fetch:options.fetch??(async(url:string,init:any)=>{calls.push({url,init,body:JSON.parse(init.body)});return url.includes('openai')?new Response(new Uint8Array([0,64,0,128])):Response.json({steps:[{content:[{mime_type:'audio/l16',sample_rate:24000,data:'AEAAgA=='}]}]});}),...(options.timeout?{AbortSignal:{any:AbortSignal.any.bind(AbortSignal),timeout:()=>AbortSignal.abort(new DOMException('timeout','TimeoutError'))}}:{})});
 return {...api,calls,env};
}
const signal=()=>new AbortController().signal;
test('registry contains only OpenAI and Gemini with real mappings and independent identity',()=>{
 const h=server();assert.deepEqual(Object.keys(h.NOA_VOICE_PROVIDERS),['openai','gemini']);assert.equal(h.NOA_VOICE_PROVIDERS.anthropic,undefined);
 assert.equal(contract.NOA_VOICE_PROFILES.openai.voice,'marin');assert.equal(contract.NOA_VOICE_PROFILES.openai.model,'gpt-4o-mini-tts');
 assert.equal(contract.NOA_VOICE_PROFILES.gemini.model,'gemini-3.8-flash-lite-tts');assert.equal(contract.NOA_VOICE_PROFILES.gemini.voice,'Sulafat');assert.equal(contract.NOA_VOICE_IDENTITY.pace,'medium');
});
test('OpenAI streams exact authoritative text, marin, PCM, style and abort signal',async()=>{
 const h=server();const stream=await h.NOA_VOICE_PROVIDERS.openai.synthesize('Exact NOA words.',signal());
 assert.deepEqual([...new Uint8Array(await new Response(stream).arrayBuffer())],[0,64,0,128]);
 const {body,init}=h.calls[0];assert.equal(body.input,'Exact NOA words.');assert.equal(body.voice,'marin');assert.equal(body.response_format,'pcm');assert.equal(body.instructions,contract.NOA_VOICE_STYLE);assert.ok(init.signal);assert.equal(init.redirect,'error');
});
// V4.2b: this exact request shape was verified against the live docs at
// https://ai.google.dev/gemini-api/docs/speech-generation during this change (not assumed) -
// the Interactions API endpoint, response_format.mime_type="audio/l16" (explicitly requesting
// headerless PCM instead of the WAV a unary request defaults to), and speech_metadata nested in
// content[].annotations[] rather than a bare top-level field.
test('Gemini uses the documented Interactions API contract, Sulafat, explicit audio/l16, and decodes steps[].content[].data exactly once',async()=>{
 const h=server();const stream=await h.NOA_VOICE_PROVIDERS.gemini.synthesize('Exact NOA words.',signal());assert.deepEqual([...new Uint8Array(await new Response(stream).arrayBuffer())],[0,64,0,128]);
 const {body,url,init}=h.calls[0];assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(init.headers['x-goog-api-key'],'test-gemini-secret');
 assert.equal(body.model,'gemini-3.8-flash-lite-tts');
 assert.equal(body.input[0].content[0].text,'Exact NOA words.');
 assert.equal(body.input[0].content[0].annotations[0].type,'speech_metadata');assert.equal(body.input[0].content[0].annotations[0].style,contract.NOA_VOICE_STYLE);
 assert.deepEqual(body.response_format,{type:'audio',mime_type:'audio/l16',sample_rate:24000});
 assert.deepEqual(body.generation_config.speech_config,[{voice:'Sulafat'}]);
});
for(const shape of [{steps:[]},{steps:[{content:[]}]},{steps:[{content:[{mime_type:'audio/l16',sample_rate:24000,data:'AEAAgA=='}]}],garbage:'a'.repeat(1000)}])
test('Gemini decode never double-decodes and accepts/rejects based only on the documented mime_type/data fields',async()=>{
 const h=server({fetch:async()=>Response.json(shape)});
 if(shape.steps.length&&shape.steps[0].content.length)await h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal());
 else await assert.rejects(h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal()),{code:'invalid_audio'});
});
for(const part of [{mime_type:'audio/wav',data:'AAAAAA=='},{mime_type:'audio/l16',data:'AA=='},{mime_type:'audio/l16',sample_rate:16000,data:'AAAAAA=='},{mime_type:'audio/l16',data:'not_base64'},{mime_type:'audio/l16',data:''}])test(`reject incompatible Gemini output ${JSON.stringify(part)}`,async()=>{
 const h=server({fetch:async()=>Response.json({steps:[{content:[part]}]})});await assert.rejects(h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal()),{code:'invalid_audio'});
});
// V4.2c: PROVEN live response is a PARAMETERIZED media type ("audio/l16; rate=24000;
// channels=1") - a strict `mime_type === "audio/l16"` equality rejected every real utterance.
// Parsed safely (media type before the first ";", each "key=value" trimmed/lowercased), never a
// blind string strip.
for(const [label,mimeType] of [['bare','audio/l16'],['rate param','audio/l16; rate=24000'],['rate+channels (proven live value)','audio/l16; rate=24000; channels=1'],['loose whitespace',' audio/l16 ;  rate = 24000 ; channels = 1 '],['uppercase media type','AUDIO/L16; rate=24000; channels=1'],['uppercase params','audio/l16; RATE=24000; CHANNELS=1']])
test(`accepts ${label}: ${JSON.stringify(mimeType)}`,async()=>{
 const h=server({fetch:async()=>Response.json({steps:[{content:[{mime_type:mimeType,data:'AEAAgA=='}]}]})});
 const stream=await h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal());
 assert.deepEqual([...new Uint8Array(await new Response(stream).arrayBuffer())],[0,64,0,128]);
});
for(const [label,mimeType] of [['wrong rate param','audio/l16; rate=16000; channels=1'],['wrong channels param','audio/l16; rate=24000; channels=2'],['unparseable rate param','audio/l16; rate=abc'],['unparseable channels param','audio/l16; rate=24000; channels=stereo']])
test(`rejects ${label}: ${JSON.stringify(mimeType)}`,async()=>{
 const h=server({fetch:async()=>Response.json({steps:[{content:[{mime_type:mimeType,data:'AEAAgA=='}]}]})});
 await assert.rejects(h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal()),{code:'invalid_audio'});
});
test('a bare "rate=24000" mime parameter alone satisfies the sample-rate check when the response has no separate sample_rate field',async()=>{
 const h=server({fetch:async()=>Response.json({steps:[{content:[{mime_type:'audio/l16; rate=24000',data:'AEAAgA=='}]}]})});
 const stream=await h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal());
 assert.deepEqual([...new Uint8Array(await new Response(stream).arrayBuffer())],[0,64,0,128]);
});
// V4.2b: a unary request's WAV default (mime_type "audio/wav", per the live docs) must never be
// accepted/stripped as if it were raw PCM - this is exactly why response_format.mime_type above
// explicitly asks for "audio/l16" instead of relying on the WAV default.
test('a WAV-header response (RIFF magic bytes, mime_type audio/wav) is rejected, never passed through as raw PCM',async()=>{
 const wav='UklGRhAAAABXQVZFZm10IBAAAAA=';const h=server({fetch:async()=>Response.json({steps:[{content:[{mime_type:'audio/wav',data:wav}]}]})});
 await assert.rejects(h.NOA_VOICE_PROVIDERS.gemini.synthesize('Text',signal()),{code:'invalid_audio'});
});
for(const [status,error,code] of [[401,{},'invalid_credential'],[429,{code:'insufficient_quota'},'quota_exhausted'],[429,{},'rate_limited'],[402,{},'billing_blocked'],[500,{},'provider_unavailable'],[400,{},'unknown']] as const)test(`provider ${status} maps ${code} without raw errors`,async()=>{
 const h=server({fetch:async()=>Response.json({error:{...error,message:'private secret'}},{status})});await assert.rejects(h.NOA_VOICE_PROVIDERS.openai.synthesize('Text',signal()),(e:any)=>e.code===code&&e.message==='Speech unavailable');
});
test('user abort and timeout are distinct; neither retries synthesis',async()=>{
 let calls=0;const abort=new AbortController();abort.abort();const h=server({fetch:async()=>{calls++;throw Error('private');}});await assert.rejects(h.NOA_VOICE_PROVIDERS.openai.synthesize('Text',abort.signal),{code:'cancelled'});assert.equal(calls,1);
 const timeout=server({timeout:true,fetch:async()=>{throw Error('private');}});await assert.rejects(timeout.NOA_VOICE_PROVIDERS.openai.synthesize('Text',signal()),{code:'timeout'});
});
test('server selects primary once, issues user-bound expiring tokens and bounded fallback',async()=>{
 const checks:string[]=[];const h=server({health:async(id:string)=>{checks.push(id);return available;}});const session=await h.createVoiceSession('owner');assert.deepEqual(checks,['openai']);assert.equal(h.calls.length,0);
 assert.equal(session.provider,'openai');assert.equal(session.next.provider,'gemini');assert.equal(session.next.next,undefined);
 const claims=h.verifyVoiceSession(session.token,'owner');assert.equal(claims.provider,'openai');assert.ok(claims.expires>Date.now());assert.equal(h.verifyVoiceSession(session.token,'other'),null);assert.equal(h.verifyVoiceSession(session.token+'x','owner'),null);
 const replacement=h.verifyVoiceSession(session.next.token,'owner');assert.equal(replacement.session,claims.session);assert.equal(replacement.expires,claims.expires);assert.equal(replacement.provider,'gemini');
 assert.doesNotMatch(JSON.stringify(session),/test-openai-secret|test-gemini-secret/);
 const forged=Buffer.from(JSON.stringify({...claims,provider:'anthropic'})).toString('base64url')+'.'+session.token.split('.')[1];assert.equal(h.verifyVoiceSession(forged,'owner'),null);
});
test('missing or failed primary selects next configured provider before session starts',async()=>{
 for(const state of [{authStatus:'invalid'},{reachability:'unavailable'},{quotaStatus:'quota_exhausted'}]){
 const h=server({health:async(id:string)=>id==='openai'?{...available,...state}:available});assert.equal((await h.createVoiceSession('owner')).provider,'gemini');assert.equal(h.calls.length,0);
 }
 assert.equal((await server({env:{GEMINI_API_KEY:'test'}}).createVoiceSession('owner')).provider,'gemini');
 await assert.rejects(server({env:{}}).createVoiceSession('owner'));
});
test('speech route accepts only valid server tokens and bounded text, never client model/voice/provider',async()=>{
 const h=server();const session=await h.createVoiceSession('owner');
 const {POST}=compile('app/api/noa/voice/speech/route.ts',{'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'owner'}}})}})},'@/lib/noa/noa-voice-provider.server':h},{process:{env:{NEXT_PUBLIC_NOA_REALTIME_VOICE:'true'}}});
 const request=(body:any)=>new Request('https://app.test/speech',{method:'POST',body:JSON.stringify(body)});
 for(const body of [{voiceText:'Hi'},{voiceText:'Hi',voiceSession:'forged'},{voiceText:'Hi',voiceSession:session.token,provider:'gemini'},{voiceText:'Hi',voiceSession:session.token,model:'other'},{voiceText:'Hi',voiceSession:session.token,voice:'other'},{voiceText:'<invalid>',voiceSession:session.token}])assert.equal((await POST(request(body))).status,400);
 assert.equal(h.calls.length,0);assert.equal((await POST(request({voiceText:'Exact',voiceSession:session.token}))).status,200);assert.equal(h.calls[0].body.input,'Exact');
});
function deferred(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return{resolve,promise};}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function playerHarness(fetch:any){
 let stopped=0,started=0;class Audio{state='running';currentTime=100;destination={};async resume(){}async close(){}createBuffer(_c:number,length:number){return{duration:0,getChannelData:()=>new Float32Array(length)};}createBufferSource(){return{connect(){},disconnect(){},start(){started++;},stop(){stopped++;}};}}
 const {createStreamingPlayer}=compile('components/noa/noa-realtime-transport.ts',{'@/lib/noa/noa-voice-provider':contract},{AudioContext:Audio,fetch});return{player:createStreamingPlayer(),counts:()=>({started,stopped})};
}
const pinned={provider:'openai',token:'primary',next:{provider:'gemini',token:'fallback'}};
for(const code of ['quota_exhausted','invalid_credential','timeout','rate_limited','billing_blocked','provider_unavailable'])test(`${code}: replacement only, no synthesis replay`,async()=>{
 let calls=0;const h=playerHarness(async()=>{calls++;return Response.json({code,error:'Speech unavailable'},{status:502});});await h.player.unlock();const next:any[]=[];
 await assert.rejects(h.player.play('Exact',signal(),()=>{},pinned,(s:any)=>next.push(s)));assert.equal(calls,1);assert.deepEqual(next,[pinned.next]);assert.equal(h.counts().started,0);
 h.player.dispose();
});
for(const [status,code] of [[400,'invalid_text'],[401,'invalid_credential'],[502,'invalid_audio'],[502,'unknown'],[502,'cancelled']] as const)test(`${status}/${code}: no fallback`,async()=>{
 const h=playerHarness(async()=>Response.json({code},{status}));await h.player.unlock();await assert.rejects(h.player.play('Exact',signal(),()=>{},pinned,()=>assert.fail('No fallback')));h.player.dispose();
});
test('stream fails after PCM playback: stop before authorizing next utterance; user abort does not replace',async()=>{
 for(const cancel of [false,true]){
 let stream:any;const h=playerHarness(async()=>new Response(new ReadableStream({start(c){stream=c;}})));await h.player.unlock();const abort=new AbortController();const next:any[]=[];
 const playing=h.player.play('Exact',abort.signal,()=>{},pinned,(s:any)=>{assert.ok(h.counts().stopped>0);next.push(s);});await flush();stream.enqueue(new Uint8Array([0,64]));await flush();assert.equal(h.counts().started,1);
 if(cancel)abort.abort();stream.error(Error('network stream failure'));await assert.rejects(playing);assert.equal(next.length,cancel?0:1);h.player.dispose();
 }
});
test('controller pins replacement across turns and clears provider on stop/restart',async()=>{
 let receive:any;let connects=0;const played:any[]=[];
 const {createNoaRealtimeVoice}=compile('components/noa/use-noa-realtime-voice.ts',{'./noa-realtime-transport':{}},{setTimeout:()=>1,clearTimeout(){}});
 const controller=createNoaRealtimeVoice({connect:async(_s:any,r:any)=>{receive=r;connects++;return pinned;},close(){}},{unlock:async()=>{},stop(){},dispose(){},play:async(text:string,_s:any,_start:any,session:any,replace:any)=>{played.push({text,session});if(played.length===1){replace(session.next);throw Error('Speech unavailable');}}},async()=>({voiceText:'Exact authoritative words'}));
 const utterance=async(id:string)=>{receive({type:'input_audio_buffer.speech_started',item_id:id});receive({type:'conversation.item.input_audio_transcription.completed',item_id:id,transcript:'Question'});await flush();};
 await controller.start();assert.equal(controller.getSnapshot().voiceSessionProvider,'openai');await utterance('one');assert.equal(controller.getSnapshot().voiceSessionProvider,'gemini');await utterance('two');await utterance('three');assert.deepEqual(played.map(x=>x.session.provider),['openai','gemini','gemini']);assert.equal(connects,1);
 controller.stop();assert.equal(controller.getSnapshot().voiceSessionProvider,null);await controller.start();assert.equal(controller.getSnapshot().voiceSessionProvider,'openai');assert.equal(connects,2);controller.stop();
});
test('new session cannot be overwritten by late connection or playback',async()=>{
 const old=deferred();let connection=0;const {createNoaRealtimeVoice}=compile('components/noa/use-noa-realtime-voice.ts',{'./noa-realtime-transport':{}},{setTimeout:()=>1,clearTimeout(){}});
 const controller=createNoaRealtimeVoice({connect:async()=>++connection===1?old.promise:pinned,close(){}},{unlock:async()=>{},stop(){},dispose(){},play:async()=>{}},async()=>({}));
 const starting=controller.start();await flush();controller.stop();await controller.start();old.resolve(pinned.next);await starting;assert.equal(controller.getSnapshot().voiceSessionProvider,'openai');controller.stop();
});

