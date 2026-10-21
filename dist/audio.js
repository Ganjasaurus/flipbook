import { SFX, timeline, uid } from './model.js';

export const SAMPLE_RATE=24000;
export function synthesize(name,rate=SAMPLE_RATE) {
  const duration={pop:.16,boing:.55,sparkle:.75,whoosh:.45,drum:.23,chirp:.28}[name]??.2;
  const data=new Float32Array(Math.ceil(rate*duration));let phase=0,seed=4927;
  for(let i=0;i<data.length;i++){
    const t=i/rate,x=t/duration,fade=Math.sin(Math.PI*Math.min(1,x*30))*Math.pow(1-x,2);
    seed=(Math.imul(seed,1664525)+1013904223)|0;const noise=(seed>>>0)/2147483648-1;
    let f=440,v=0;
    if(name==='pop')f=900*Math.exp(-t*22)+80;
    if(name==='boing')f=170+380*Math.exp(-t*8)*(1+.2*Math.sin(t*60));
    if(name==='chirp')f=850+Math.sin(x*Math.PI)*1100;
    if(name==='drum')f=65+90*Math.exp(-t*28);
    if(name==='sparkle')f=[1046.5,1318.5,1568,2093][Math.min(3,Math.floor(x*4))];
    phase+=2*Math.PI*f/rate;
    if(name==='whoosh')v=noise*Math.sin(x*Math.PI)*.35;
    else if(name==='sparkle')v=(Math.sin(phase)+.3*Math.sin(phase*2))*fade*.25;
    else v=(Math.sin(phase)+(name==='drum'?noise*.15:0))*fade*.4;
    data[i]=v;
  }return data;
}
export class AudioStudio {
  constructor(){this.ctx=null;this.enabled=true;this.buffers=new Map();this.voices=new Set();this.timer=0;this.session=0;}
  async unlock(){
    if(!this.ctx){const AC=globalThis.AudioContext??globalThis.webkitAudioContext;if(!AC)throw new Error('Sound is unavailable in this browser. Your drawings still work.');this.ctx=new AC();}
    if(this.ctx.state==='suspended')await this.ctx.resume();return this.ctx;
  }
  async buffer(sound,project){
    const key=project.recordings[sound]?.data??sound;if(this.buffers.has(key))return this.buffers.get(key);
    const ctx=await this.unlock();let buffer;
    if(SFX.includes(sound)){const data=synthesize(sound,ctx.sampleRate);buffer=ctx.createBuffer(1,data.length,ctx.sampleRate);buffer.copyToChannel(data,0);}
    else {const r=project.recordings[sound];if(!r)throw new Error('That recording is missing.');const base64=r.data.slice(r.data.indexOf(',')+1),binary=atob(base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));buffer=await ctx.decodeAudioData(bytes.buffer);if(buffer.duration>31)throw new Error('Recordings can be up to 30 seconds.');}
    this.buffers.set(key,buffer);return buffer;
  }
  voice(buffer,when,volume=1,destination){
    if(this.voices.size>=24)return;
    const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=buffer;gain.gain.value=volume*.7;source.connect(gain);gain.connect(destination??this.ctx.destination);this.voices.add(source);
    source.onended=()=>{this.voices.delete(source);source.disconnect();gain.disconnect();};source.start(Math.max(this.ctx.currentTime,when));
  }
  async preview(sound,p){const session=this.session;await this.unlock();const buffer=await this.buffer(sound,p);if(session===this.session)this.voice(buffer,this.ctx.currentTime,.8);}
  async prepare(p){await this.unlock();const sounds=new Set(p.frames.flatMap(f=>f.cues.map(c=>c.sound)));for(const sound of sounds)await this.buffer(sound,p);}
  async play(p,{start=0,loop=p.loop,destination,force=false}={}){
    this.stop();if(!this.enabled&&!force)return;
    const session=this.session;await this.prepare(p);if(session!==this.session)return;
    const list=timeline(p),duration=list.at(-1).end,origin=this.ctx.currentTime+.025-start;
    let cycle=0,cursor=0;
    while(cursor<list.length&&list[cursor].start<start-.001)cursor++;
    const schedule=()=>{
      const horizon=this.ctx.currentTime+.15;
      while(origin+cycle*duration+(list[cursor]?.start??duration)<horizon){
        if(cursor>=list.length){if(!loop){clearInterval(this.timer);this.timer=0;return;}cycle++;cursor=0;}
        const entry=list[cursor++],when=origin+cycle*duration+entry.start;
        for(const cue of p.frames[entry.index].cues){const key=p.recordings[cue.sound]?.data??cue.sound,buffer=this.buffers.get(key);if(buffer&&when>=this.ctx.currentTime-.06)this.voice(buffer,when,cue.volume,destination);}
      }
    };schedule();this.timer=setInterval(schedule,40);
  }
  stop(){this.session++;clearInterval(this.timer);this.timer=0;for(const voice of this.voices){try{voice.stop();}catch{}}this.voices.clear();}
  clear(){this.stop();this.buffers.clear();}
  async mix(p){
    await this.prepare(p);const entries=timeline(p),length=Math.ceil(entries.at(-1).end*SAMPLE_RATE);if(length>SAMPLE_RATE*180)throw new Error('Sound exports support animations up to three minutes.');
    const samples=new Float32Array(length);
    for(const e of entries)for(const cue of p.frames[e.index].cues){const buffer=await this.buffer(cue.sound,p),start=Math.round(e.start*SAMPLE_RATE),count=Math.min(length-start,Math.ceil(buffer.duration*SAMPLE_RATE));
      for(let i=0;i<count;i++){const sourceIndex=Math.min(buffer.length-1,Math.floor(i*buffer.sampleRate/SAMPLE_RATE));let value=0;for(let ch=0;ch<buffer.numberOfChannels;ch++)value+=buffer.getChannelData(ch)[sourceIndex]/buffer.numberOfChannels;samples[start+i]+=value*cue.volume*.7;}
    }return wav(samples,SAMPLE_RATE);
  }
}
export function wav(samples,rate){
  const data=new ArrayBuffer(44+samples.length*2),view=new DataView(data),str=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i));};
  str(0,'RIFF');view.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  return new Blob([data],{type:'audio/wav'});
}
export class Microphone {
  constructor(){this.recorder=null;this.stream=null;this.pending=false;this.cancelled=false;}
  async start({onTick=()=>{},onStop=()=>{},onError=()=>{}}={}){
    if(this.pending||this.recorder)throw new Error('The microphone is already busy.');
    if(!navigator.mediaDevices?.getUserMedia||!globalThis.MediaRecorder)throw new Error('Recording needs a browser with microphone support, on HTTPS or localhost.');
    this.pending=true;this.cancelled=false;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});this.stream=stream;
      if(this.cancelled){this.release();return;}
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:64000}:undefined);this.recorder=recorder;const chunks=[];let bytes=0;this.started=performance.now();
      recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>4*1024*1024)this.stop();}};
      recorder.onerror=()=>{this.cancelled=true;this.release();onError(new Error('The microphone stopped working. Please try again.'));};
      recorder.onstop=async()=>{
        const duration=Math.min(30,(performance.now()-this.started)/1000),cancelled=this.cancelled;this.release();if(cancelled)return;
        try{if(duration<.1||!chunks.length)throw new Error('That recording was too short. Try again.');
          const blob=new Blob(chunks,{type:recorder.mimeType.replaceAll('"','')}),data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
          onStop({id:uid(),name:'My sound',duration,data});
        }catch(error){onError(error);}
      };
      recorder.start(250);this.timer=setInterval(()=>{const seconds=(performance.now()-this.started)/1000;onTick(seconds);if(seconds>=30)this.stop();},100);
    }catch(error){this.release();if(!this.cancelled)throw new Error(error.name==='NotAllowedError'?'Microphone access was not allowed. You can still use the sound effects.':error.name==='NotFoundError'?'No microphone was found on this device.':'The microphone could not start. Please try again.');}
    finally{this.pending=false;}
  }
  stop(cancel=false){this.cancelled=cancel;clearInterval(this.timer);if(this.recorder?.state==='recording')this.recorder.stop();else this.release();}
  release(){clearInterval(this.timer);this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.recorder=null;}
}
