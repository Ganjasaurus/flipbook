import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesize, wav, AudioStudio, Microphone } from '../dist/audio.js';
import { newProject, updateFrame, parseProject } from '../dist/model.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class AudioContext {
  constructor(){this.sampleRate=24000;this.state='running';this.currentTime=1;this.destination={};this.started=[];}
  async resume(){this.state='running';}
  createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return{length,sampleRate:rate,duration:length/rate,numberOfChannels:channels,copyToChannel:(a,i)=>data[i].set(a),getChannelData:i=>data[i]};}
  createGain(){return{gain:{value:1},connect(){},disconnect(){}};}
  createBufferSource(){const context=this;return{connect(){},disconnect(){},start(time){context.started.push({time,buffer:this.buffer});},stop(){this.onended?.();}};}
}
test('all built-in sounds are finite, deterministic, short, and different',()=>{
  const sounds=['pop','boing','sparkle','whoosh','drum','chirp'].map(name=>{const data=synthesize(name);assert(data.length>1000&&data.length<24000);assert(data.every(n=>Number.isFinite(n)&&Math.abs(n)<=1));assert(data.some(n=>Math.abs(n)>.01));assert.deepEqual(data,synthesize(name));return data.length;});assert.equal(new Set(sounds).size,6);
});
test('WAV has correct PCM headers, sample count, and clips peaks safely',async()=>{
  const buffer=await wav(new Float32Array([-2,0,2]),24000).arrayBuffer(),view=new DataView(buffer);assert.equal(new TextDecoder().decode(buffer.slice(0,4)),'RIFF');assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(40,true),6);assert.equal(view.getInt16(44,true),-32767);assert.equal(view.getInt16(48,true),32767);
});
test('audio obeys mute, voice limits, schedule cancellation, and soundtrack duration',async()=>{
  globalThis.AudioContext=AudioContext;const audio=new AudioStudio();let p=newProject();p.fps=4;p=updateFrame(p,0,{hold:4,cues:[{sound:'pop',volume:1}]});
  audio.enabled=false;await audio.play(p);assert.equal(audio.ctx,null);audio.enabled=true;await audio.play(p);assert(audio.timer);assert.equal(audio.ctx.started.length,1);audio.stop();assert.equal(audio.timer,0);assert.equal(audio.voices.size,0);
  const buffer=await audio.buffer('pop',p);for(let i=0;i<40;i++)audio.voice(buffer,1);assert.equal(audio.voices.size,24);audio.stop();
  const bytes=await(await audio.mix(p)).arrayBuffer(),view=new DataView(bytes);assert.equal(view.getUint32(40,true),24000*2);assert(new Int16Array(bytes,44).some(n=>n!==0));audio.clear();assert.equal(audio.buffers.size,0);
});
class MediaRecorder {
  static isTypeSupported(type){return type==='audio/webm;codecs=opus';}
  constructor(stream,opts){this.stream=stream;this.mimeType=opts.mimeType;this.state='inactive';}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['fake audio'],{type:this.mimeType})});queueMicrotask(()=>this.onstop?.());}
}
class FileReader {async readAsDataURL(blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onload?.();}}
function microphoneEnvironment(getUserMedia){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia}}});globalThis.MediaRecorder=MediaRecorder;globalThis.FileReader=FileReader;}
test('microphone requires an explicit start, saves a portable project payload, and releases tracks',async()=>{
  let requests=0,stops=0;const stream={getTracks:()=>[{stop(){stops++;}}]};microphoneEnvironment(async constraints=>{requests++;assert.equal(constraints.video,false);return stream;});
  const mic=new Microphone();assert.equal(requests,0);let record;await mic.start({onStop:r=>record=r});assert.equal(requests,1);mic.started-=500;mic.stop();await tick();await tick();assert.equal(stops,1);assert(record.duration>=.5);assert.equal(mic.recorder,null);assert.match(record.data,/^data:audio\/webm;codecs=opus;base64,/);
  const p=newProject();p.recordings[record.id]={name:record.name,duration:record.duration,data:record.data};assert.doesNotThrow(()=>parseProject(JSON.stringify(p)));
});
test('closing while permission is pending releases the stream and never starts recording',async()=>{
  let resolvePermission,stops=0;microphoneEnvironment(()=>new Promise(resolve=>resolvePermission=resolve));const mic=new Microphone();const pending=mic.start();mic.stop(true);resolvePermission({getTracks:()=>[{stop(){stops++;}}]});await pending;assert.equal(stops,1);assert.equal(mic.recorder,null);
});
test('permission denial and recorder construction failures release hardware and give actionable errors',async()=>{
  microphoneEnvironment(async()=>{const e=new Error();e.name='NotAllowedError';throw e;});await assert.rejects(new Microphone().start(),/not allowed/);
  let stopped=0;microphoneEnvironment(async()=>({getTracks:()=>[{stop(){stopped++;}}]}));globalThis.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){throw new Error('no codec');}};await assert.rejects(new Microphone().start(),/could not start/);assert.equal(stopped,1);
});
