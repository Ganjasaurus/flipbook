import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as ThreadWorker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { createCanvas } from '@napi-rs/canvas';
import { newProject, insertFrame, updateFrame, appendOperation } from '../dist/model.js';
import { Renderer } from '../dist/drawing.js';
import { exportGIF, zip, crc32, exportFrames, videoType } from '../dist/export.js';
const require=createRequire(import.meta.url),{GifReader}=require('omggif');
globalThis.document={createElement:()=>{const c=createCanvas(1,1);c.toBlob=callback=>callback(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;}};
let workers=0;
// Native test canvases use external ArrayBuffers; copy these into transferable JS memory.
globalThis.Worker=class{constructor(){workers++;this.worker=new ThreadWorker(new URL('./gif-worker-thread.mjs',import.meta.url));this.worker.on('message',data=>this.onmessage?.({data}));this.worker.on('error',error=>this.onerror?.(error));}postMessage(data,transfer){if(data.pixels){data={...data,pixels:new Uint8ClampedArray(data.pixels)};transfer=[data.pixels.buffer];}this.worker.postMessage(data,transfer);}terminate(){workers--;return this.worker.terminate();}};
test('GIF independently decodes all frames with colors, frame holds, loops, and accurate high-fps duration',async()=>{
  let p=newProject(100,80);p.fps=30;for(let i=0;i<8;i++)p=insertFrame(p,i);
  for(let i=0;i<p.frames.length;i++)p=appendOperation(p,i,p.layers[0].id,{kind:'shape',shape:'rectangle',from:[i*5,5],to:[i*5+30,50],color:i%2?'#ff0000':'#0000ff',size:1,opacity:1,fill:true});
  p=updateFrame(p,3,{hold:3});const progress=[],blob=await exportGIF(p,new Renderer(),{onProgress:v=>progress.push(v)}),bytes=new Uint8Array(await blob.arrayBuffer()),reader=new GifReader(bytes);
  assert.equal(reader.width,100);assert.equal(reader.height,80);assert.equal(reader.numFrames(),9);assert.equal(reader.loopCount(),0);let duration=0;
  for(let i=0;i<reader.numFrames();i++){const out=new Uint8Array(100*80*4);reader.decodeAndBlitFrameRGBA(i,out);duration+=reader.frameInfo(i).delay;const at=(20*100+i*5+10)*4;assert(out[at+(i%2?0:2)]>230);}
  assert.equal(duration,Math.round(11/30*100));assert.equal(progress.at(-1),1);assert.equal(workers,0);
});
test('GIF export without looping carries no loop extension and cancellation terminates the worker',async()=>{
  const p=newProject(100,80);p.loop=false;const bytes=new Uint8Array(await(await exportGIF(p,new Renderer())).arrayBuffer());assert.equal(new GifReader(bytes).loopCount(),null);
  const controller=new AbortController(),promise=exportGIF(p,new Renderer(),{signal:controller.signal});controller.abort();await assert.rejects(promise,{name:'AbortError'});assert.equal(workers,0);
});
test('ZIP records contain correct CRC, payload, central directory, and end record',async()=>{
  const data=new TextEncoder().encode('A little animation');assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);const bytes=new Uint8Array(await zip([{name:'hello.txt',data}]).arrayBuffer()),view=new DataView(bytes.buffer),nameLength=view.getUint16(26,true);
  assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint32(14,true),crc32(data));assert.deepEqual(bytes.slice(30+nameLength,30+nameLength+data.length),data);assert.equal(view.getUint32(30+nameLength+data.length,true),0x02014b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
});
test('PNG sequence export includes pictures and timing metadata, and respects cancellation',async()=>{
  const p=insertFrame(newProject(100,80),0),blob=await exportFrames(p,new Renderer()),bytes=new Uint8Array(await blob.arrayBuffer()),text=new TextDecoder().decode(bytes);assert(text.includes('frame-001.png'));assert(text.includes('frame-002.png'));assert(text.includes('timing.json'));assert(text.includes('"fps": 8'));
  const controller=new AbortController();controller.abort();await assert.rejects(exportFrames(p,new Renderer(),{signal:controller.signal}),{name:'AbortError'});
});
test('unsupported video export is detected without breaking other formats',()=>{delete globalThis.MediaRecorder;assert.equal(videoType(),null);});
