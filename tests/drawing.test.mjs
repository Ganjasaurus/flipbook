import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, GlobalFonts, Image } from '@napi-rs/canvas';
import { mkdir, writeFile } from 'node:fs/promises';
import { newProject, appendOperation, updateFrame, BRUSHES } from '../dist/model.js';
import { Renderer, fillPixels, renderOperation } from '../dist/drawing.js';
import { starterProject } from '../dist/starter.js';
globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.Image=Image;
GlobalFonts.registerFromPath(new URL('../dist/fonts/dm-sans.woff2',import.meta.url).pathname,'DM Sans');
const pixel=(c,x,y)=>Array.from(c.getContext('2d').getImageData(x,y,1,1).data);
const alphaCount=c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=3;i<a.length;i+=4)if(a[i])count++;return count;};

test('every brush produces distinct, deterministic pixels and respects transparent erasing',()=>{
  const outputs=[];
  for(const brush of Object.keys(BRUSHES).filter(b=>b!=='eraser')){
    const a=createCanvas(160,80),b=createCanvas(160,80),op={kind:'stroke',brush,color:'#ff9955',size:25,opacity:.8,points:[[15,40,.3],[80,35,.7],[145,40,1]]};
    renderOperation(a.getContext('2d'),op);renderOperation(b.getContext('2d'),op);assert(alphaCount(a)>30,brush);assert.deepEqual(a.toBuffer('image/png'),b.toBuffer('image/png'));outputs.push(a.toBuffer('image/png').toString('base64'));
  }assert.equal(new Set(outputs).size,outputs.length);
  const c=createCanvas(60,60),ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,60,60);renderOperation(ctx,{kind:'stroke',brush:'eraser',color:'#000000',size:25,opacity:1,points:[[30,30,1]]});assert.equal(pixel(c,30,30)[3],0);assert.equal(pixel(c,2,2)[3],255);
});
test('pressure changes line width and opacity changes deposited alpha',()=>{
  const c=createCanvas(100,100),ctx=c.getContext('2d');const op={kind:'stroke',brush:'pen',color:'#112233',size:30,opacity:1,points:[[25,50,.1]]};renderOperation(ctx,op);renderOperation(ctx,{...op,points:[[75,50,1]]});assert.equal(pixel(c,25,62)[3],0);assert(pixel(c,75,62)[3]>200);
  const soft=createCanvas(100,100);renderOperation(soft.getContext('2d'),{...op,opacity:.2});assert(pixel(soft,25,50)[3]<80);
});
test('flood fill stays inside boundaries, handles transparent edges and repeated fills',()=>{
  const c=createCanvas(100,100),ctx=c.getContext('2d');ctx.strokeStyle='#000';ctx.lineWidth=4;ctx.strokeRect(20,20,60,60);let data=ctx.getImageData(0,0,100,100);fillPixels(data,40,40,'#55b9a0');ctx.putImageData(data,0,0);assert.deepEqual(pixel(c,40,40),[85,185,160,255]);assert.equal(pixel(c,5,5)[3],0);fillPixels(data,40,40,'#55b9a0');fillPixels(data,-1,-1,'#ffffff');
  fillPixels(data,5,5,'#ffeeee');ctx.putImageData(data,0,0);assert.deepEqual(pixel(c,5,5),[255,238,238,255]);assert.deepEqual(pixel(c,40,40),[85,185,160,255]);
});
test('compositing respects layer order, opacity, visibility, and a changed paper color',()=>{
  let p=newProject(100,100);const r=new Renderer();
  for(const [i,color]of[[1,'#ff0000'],[0,'#0000ff']])p=appendOperation(p,0,p.layers[i].id,{kind:'shape',shape:'rectangle',from:[20,20],to:[80,80],fill:true,size:1,opacity:1,color});
  assert.deepEqual(pixel(r.frame(p,0),40,40),[0,0,255,255]);p={...p,layers:p.layers.map((l,i)=>i===0?{...l,visible:false}:l)};assert.deepEqual(pixel(r.frame(p,0),40,40),[255,0,0,255]);p={...p,background:'#123456'};assert.deepEqual(pixel(r.frame(p,0),0,0),[18,52,86,255]);
});
test('onion rendering cannot modify neighboring drawings or cached exports',()=>{
  const p=starterProject(),r=new Renderer(),before=r.frame(p,0).toBuffer('image/png'),c=createCanvas(p.width,p.height);r.drawOnion(c.getContext('2d'),p,1);assert(alphaCount(c)>0);assert.deepEqual(r.frame(p,0).toBuffer('image/png'),before);
});
test('moving a layer changes its pixels and cache stays inside its memory budget',()=>{
  let p=newProject(100,100),r=new Renderer();p=appendOperation(p,0,p.layers[0].id,{kind:'shape',shape:'rectangle',from:[10,10],to:[20,20],color:'#000000',size:1,opacity:1,fill:true});p=appendOperation(p,0,p.layers[0].id,{kind:'transform',offset:[30,0]});const c=r.layer(p,p.frames[0].cells[p.layers[0].id]);assert.equal(pixel(c,15,15)[3],0);assert.equal(pixel(c,45,15)[3],255);
  r.pixelBudget=20000;for(let i=0;i<30;i++){p=updateFrame(p,0,{hold:i+1});r.frame(p,0);}assert(r.pixels<=r.pixelBudget);assert(r.lru.size<=3);
});
test('starter renders all frames and creates a representative drawing artifact',async()=>{
  const p=starterProject(),r=new Renderer(),buffers=p.frames.map((_,i)=>r.frame(p,i).toBuffer('image/png'));assert(new Set(buffers.map(b=>b.toString('base64'))).size>=6);
  await mkdir('/workspace/flipbook-qa',{recursive:true});await writeFile('/workspace/flipbook-qa/starter-frame.png',buffers[0]);
});
