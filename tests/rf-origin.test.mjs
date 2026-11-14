import test from 'node:test';
import assert from 'node:assert/strict';
import { sendToRfApp } from '../dist/rf-bridge.js';
test('media transfer binds popup origin and rejects forged acknowledgments', async () => {
 const oldWindow=globalThis.window, oldLocation=globalThis.location, oldBC=globalThis.BroadcastChannel;
 const handlers=new Set(); let token, settled=false, count=0;
 const expected='https://fotoe.retrofleshed.com';
 const child={ postMessage(packet, origin) { assert.equal(origin,expected); token=packet.token; count++; } };
 const emit=(origin,source,type,t=token)=>{for(const h of [...handlers])h({origin,source,data:{type,token:t}})};
 globalThis.BroadcastChannel=undefined;
 globalThis.location={origin:'https://flipbook.retrofleshed.com',href:'https://flipbook.retrofleshed.com/'};
 globalThis.window={open(url){token=new URL(url).searchParams.get('rf_token');return child},addEventListener(_,h){handlers.add(h)},removeEventListener(_,h){handlers.delete(h)}};
 try {
  const pending=sendToRfApp({from:'flipbook',to:'fotoe',kind:'image',producePayload:async()=>({bytes:new Uint8Array([1,2,3]),name:'test.png',mime:'image/png'})});
  pending.then(()=>{settled=true}); await new Promise(r=>setTimeout(r,10));
  emit('https://attacker.invalid',child,'rf:ready'); emit(expected,{},'rf:ready');
  assert.equal(count,0);
  emit(expected,child,'rf:ready'); assert.equal(count,1);
  emit('https://attacker.invalid',child,'rf:ack'); emit(expected,{},'rf:ack'); emit(expected,child,'rf:ack','wrong-token');
  await Promise.resolve(); assert.equal(settled,false);
  emit(expected,child,'rf:ack'); assert.equal((await pending).delivered,true);
 } finally {globalThis.window=oldWindow;globalThis.location=oldLocation;globalThis.BroadcastChannel=oldBC;}
});
