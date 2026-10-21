import { createCanvas } from '@napi-rs/canvas';
import { performance } from 'node:perf_hooks';
import { Renderer, stamp, strokeSegment } from '../dist/drawing.js';
import { starterProject } from '../dist/starter.js';
globalThis.document={createElement:()=>createCanvas(1,1)};
const p=starterProject(),renderer=new Renderer(),screen=createCanvas(p.width,p.height),ctx=screen.getContext('2d'),layer=createCanvas(p.width,p.height),brushCtx=layer.getContext('2d');
const times=[];renderer.frame(p,0);renderer.drawOnion(ctx,p,1);
for(let i=0;i<200;i++){
  const op={kind:'stroke',brush:['pen','pencil','crayon','watercolor','airbrush'][i%5],size:18,color:'#f56e53',opacity:.8,points:[[120,120,.5],[180,140,.7]]};
  const start=performance.now();stamp(brushCtx,op,op.points[0]);strokeSegment(brushCtx,op,...op.points,1);ctx.fillStyle=p.background;ctx.fillRect(0,0,p.width,p.height);renderer.drawOnion(ctx,p,1);ctx.drawImage(renderer.frame(p,1),0,0);ctx.drawImage(layer,0,0);times.push(performance.now()-start);
}
times.sort((a,b)=>a-b);console.log(JSON.stringify({scenario:'200 drawing updates with textured brushes, cached onion skin, and 960x600 compositing',medianMs:Number(times[100].toFixed(2)),p95Ms:Number(times[190].toFixed(2)),canvasCacheMiB:Number((renderer.pixels*4/1024/1024).toFixed(2)),limitMiB:32,note:'Native CPU canvas measurement in this environment; not a browser, GPU, or physical-device frame-rate guarantee.'},null,2));
