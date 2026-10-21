import { canvas, context } from './drawing.js';
import { timeline } from './model.js';
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
export const filename=p=>(p.title.trim()||'My flipbook').replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,60)||'Flipbook';
export function png(c){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(new Error('The picture could not be exported.')),'image/png'));}
export function exportGIF(p,renderer,{onProgress=()=>{},signal,maxWidth=640}={}){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./gif-worker.js',import.meta.url),{type:'module'});let index=0,settled=false,totalMs=0,encodedTicks=0;
    const scale=Math.min(1,maxWidth/p.width),width=Math.round(p.width*scale),height=Math.round(p.height*scale),c=canvas(width,height),ctx=context(c);
    const end=(error,result)=>{if(settled)return;settled=true;worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
    const abort=()=>end(new DOMException('Export cancelled','AbortError'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
    worker.onerror=()=>end(new Error('GIF export could not finish. Try a smaller flipbook.'));
    worker.onmessage=e=>{try{
      if(e.data.error){end(new Error(e.data.error));return;}
      if(e.data.done){end(null,new Blob([e.data.bytes],{type:'image/gif'}));return;}
      if(index>=p.frames.length){worker.postMessage({type:'finish'});return;}
      ctx.drawImage(renderer.frame(p,index),0,0,width,height);const pixels=ctx.getImageData(0,0,width,height).data;
      totalMs+=1000*p.frames[index].hold/p.fps;const nextTicks=Math.round(totalMs/10),delay=(nextTicks-encodedTicks)*10;encodedTicks=nextTicks;
      worker.postMessage({type:'frame',pixels,width,height,delay,repeat:p.loop?0:-1},[pixels.buffer]);onProgress(++index/p.frames.length);
    }catch(error){end(error);}};
    try{worker.postMessage({type:'start'});}catch(error){end(error);}
  });
}
export function videoType(){if(!globalThis.MediaRecorder)return null;return ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t))??null;}
export async function exportVideo(p,renderer,audio,{onProgress=()=>{},signal}={}){
  const mime=videoType(),duration=timeline(p).at(-1).end;if(!mime||!HTMLCanvasElement.prototype.captureStream)throw new Error('Video export is unavailable here. Try GIF, or a current Chrome, Edge, or Safari browser.');
  if(duration>180)throw new Error('Video export supports animations up to three minutes.');
  await audio.prepare(p);if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');
  const c=canvas(p.width,p.height),ctx=context(c);ctx.drawImage(renderer.frame(p,0),0,0);
  const stream=c.captureStream(Math.max(30,p.fps)),mix=audio.ctx.createMediaStreamDestination();mix.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
  return new Promise((resolve,reject)=>{
    let recorder,raf=0,complete=false,aborted=false,last=-1,error=null;const chunks=[],entries=timeline(p);
    const cleanup=()=>{cancelAnimationFrame(raf);audio.stop();stream.getTracks().forEach(t=>t.stop());mix.disconnect();signal?.removeEventListener('abort',abort);document.removeEventListener('visibilitychange',hidden);};
    const abort=()=>{aborted=true;if(recorder?.state==='recording')recorder.stop();else{cleanup();reject(new DOMException('Export cancelled','AbortError'));}};
    const hidden=()=>{if(document.hidden){error=new Error('Video export paused when the app was hidden. Keep Flipbook open and try again.');abort();}};
    signal?.addEventListener('abort',abort,{once:true});document.addEventListener('visibilitychange',hidden);
    try{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4000000});}catch(e){cleanup();reject(e);return;}
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    recorder.onerror=()=>{error=new Error('Your browser could not record the video. Try GIF instead.');abort();};
    recorder.onstop=()=>{cleanup();if(aborted||!complete)reject(error??new DOMException('Export cancelled','AbortError'));else resolve({blob:new Blob(chunks,{type:mime}),extension:mime.startsWith('video/mp4')?'mp4':'webm'});};
    try{recorder.start(200);}catch(e){cleanup();reject(new Error('Video recording could not start. Try GIF instead.'));return;}
    audio.play(p,{start:0,loop:false,destination:mix,force:true}).catch(e=>{error=e;abort();});const started=performance.now();
    const tick=now=>{const elapsed=(now-started)/1000,index=entries.find(e=>elapsed<e.end)?.index??p.frames.length-1;if(index!==last){ctx.drawImage(renderer.frame(p,index),0,0);last=index;}onProgress(Math.min(1,elapsed/duration));if(elapsed>=duration){complete=true;recorder.stop();return;}raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
  });
}
// A standards-compliant, uncompressed ZIP keeps PNG frame export dependency-free.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(data){let n=0xffffffff;for(const byte of data)n=crcTable[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
export function zip(files){
  const parts=[],central=[];let offset=0;const encode=new TextEncoder();
  for(const file of files){const name=encode.encode(file.name),data=file.data,crc=crc32(data),head=new Uint8Array(30+name.length),v=new DataView(head.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);head.set(name,30);parts.push(head,data);
    const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,name.length,true);cv.setUint32(42,offset,true);c.set(name,46);central.push(c);offset+=head.length+data.length;
  }
  const size=central.reduce((n,c)=>n+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);return new Blob([...parts,...central,end],{type:'application/zip'});
}
export async function exportFrames(p,renderer,{onProgress=()=>{},signal}={}){
  const files=[];let bytes=0;
  for(let i=0;i<p.frames.length;i++){
    if(signal?.aborted)throw new DOMException('Export cancelled','AbortError');
    const blob=await png(renderer.frame(p,i));bytes+=blob.size;if(bytes>64*1024*1024)throw new Error('These pictures are too large for one ZIP. Export a GIF or project file instead.');
    files.push({name:`frame-${String(i+1).padStart(3,'0')}.png`,data:new Uint8Array(await blob.arrayBuffer())});onProgress((i+1)/p.frames.length);await new Promise(resolve=>setTimeout(resolve,0));
  }
  files.push({name:'timing.json',data:new TextEncoder().encode(JSON.stringify({fps:p.fps,loop:p.loop,frames:timeline(p)},null,2))});return zip(files);
}
