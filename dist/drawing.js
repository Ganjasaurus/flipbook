import { clamp } from './model.js';

export function canvas(width, height) {
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
}
export const context = (c, willRead = false) => c.getContext('2d', willRead ? { willReadFrequently: true } : undefined);
function random(seed) { let s = seed | 0; return () => { s = Math.imul(s ^ s >>> 16, 0x45d9f3b); s = Math.imul(s ^ s >>> 16, 0x45d9f3b); return ((s ^= s >>> 16) >>> 0) / 4294967296; }; }

export function stamp(ctx, op, point, index = 0) {
  const [x, y, pressure] = point, r = Math.max(.5, op.size * (.35 + .65 * pressure) / 2);
  ctx.save(); ctx.fillStyle = op.color; ctx.strokeStyle = op.color; ctx.globalAlpha = op.opacity;
  if (op.brush === 'eraser') ctx.globalCompositeOperation = 'destination-out';
  if (op.brush === 'pixel') {
    const s = Math.max(1, Math.round(op.size)); ctx.fillRect(Math.floor(x/s)*s, Math.floor(y/s)*s, s, s);
  } else if (op.brush === 'pencil' || op.brush === 'crayon') {
    const rng = random((Math.round(x*13) ^ Math.round(y*31) ^ index*97) + 1);
    const dots = op.brush === 'pencil' ? 7 : 22;
    ctx.globalAlpha *= op.brush === 'pencil' ? .34 : .32;
    for (let i=0;i<dots;i++) { const a=rng()*Math.PI*2, d=Math.sqrt(rng())*r, s=Math.max(.5,r*.18*rng()); ctx.fillRect(x+Math.cos(a)*d,y+Math.sin(a)*d,s,s); }
  } else if (op.brush === 'airbrush' || op.brush === 'watercolor') {
    const gradient = ctx.createRadialGradient(x,y,0,x,y,r); gradient.addColorStop(0, op.color + (op.brush==='airbrush'?'24':'18')); gradient.addColorStop(.6,op.color+'12'); gradient.addColorStop(1,op.color+'00');
    ctx.fillStyle=gradient;ctx.fillRect(x-r,y-r,r*2,r*2);
  } else {
    if (op.brush === 'marker') ctx.globalAlpha *= .28;
    if (op.brush === 'neon') { ctx.shadowColor=op.color;ctx.shadowBlur=r*2.5; }
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    if (op.brush === 'neon') {ctx.shadowBlur=0;ctx.globalAlpha*=.7;ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(x,y,r*.32,0,Math.PI*2);ctx.fill();}
  }
  ctx.restore();
}
export function strokeSegment(ctx, op, a, b, index = 0) {
  const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const spacing=Math.max(.65,op.size*(op.brush==='pixel'?.22:op.brush==='watercolor'?.13:.16));
  const steps=Math.max(1,Math.ceil(distance/spacing));
  for(let i=1;i<=steps;i++) {const t=i/steps;stamp(ctx,op,[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t],index*1000+i);}
}
export function fillPixels(image, x, y, hex, tolerance = 32) {
  const {data,width:w,height:h}=image; x=Math.floor(x);y=Math.floor(y);
  if(x<0||y<0||x>=w||y>=h)return image;
  const seed=(y*w+x)*4, target=Array.from(data.slice(seed,seed+4)), rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  if(target[3]===255&&rgb.every((v,i)=>v===target[i]))return image;
  const queue=new Uint32Array(w*h), seen=new Uint8Array(w*h);let head=0,tail=0;
  const match=i=>Math.abs(data[i+3]-target[3])<=tolerance&&(target[3]===0||Math.abs(data[i]-target[0])<=tolerance&&Math.abs(data[i+1]-target[1])<=tolerance&&Math.abs(data[i+2]-target[2])<=tolerance);
  const add=p=>{if(seen[p])return;seen[p]=1;const i=p*4;if(!match(i))return;data[i]=rgb[0];data[i+1]=rgb[1];data[i+2]=rgb[2];data[i+3]=255;queue[tail++]=p;};
  add(y*w+x);
  while(head<tail){const p=queue[head++],col=p%w;if(col>0)add(p-1);if(col<w-1)add(p+1);if(p>=w)add(p-w);if(p<w*(h-1))add(p+w);}
  return image;
}
export function renderOperation(ctx, op, images = new Map()) {
  ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.fillStyle=ctx.strokeStyle=op.color??'#32243f';ctx.lineWidth=op.size??1;ctx.globalAlpha=op.opacity??1;
  if(op.kind==='stroke') {
    ctx.restore();stamp(ctx,op,op.points[0]);for(let i=1;i<op.points.length;i++)strokeSegment(ctx,op,op.points[i-1],op.points[i],i);return;
  }
  if(op.kind==='shape') {
    const [x,y]=op.from,[x2,y2]=op.to,w=x2-x,h=y2-y;ctx.beginPath();
    if(op.shape==='line'){ctx.moveTo(x,y);ctx.lineTo(x2,y2);}
    if(op.shape==='rectangle')ctx.rect(x,y,w,h);
    if(op.shape==='ellipse')ctx.ellipse((x+x2)/2,(y+y2)/2,Math.abs(w)/2||.1,Math.abs(h)/2||.1,0,0,2*Math.PI);
    if(op.shape==='star'){const cx=(x+x2)/2,cy=(y+y2)/2,rx=Math.abs(w)/2,ry=Math.abs(h)/2;for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?.45:1;const px=cx+Math.cos(a)*rx*r,py=cy+Math.sin(a)*ry*r;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();}
    op.fill&&op.shape!=='line'?ctx.fill():ctx.stroke();
  } else if(op.kind==='fill') {
    const image=ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height);fillPixels(image,...op.at,op.color);ctx.putImageData(image,0,0);
  } else if(op.kind==='text') {
    ctx.font=`700 ${op.size}px "DM Sans", sans-serif`;ctx.textBaseline='top';op.text.split('\n').forEach((line,i)=>ctx.fillText(line,op.at[0],op.at[1]+i*op.size*1.2));
  } else if(op.kind==='image') {
    const image=images.get(op.src);if(image)ctx.drawImage(image,...op.at,op.width,op.height);
  } else if(op.kind==='transform') {
    const temp=canvas(ctx.canvas.width,ctx.canvas.height);context(temp).drawImage(ctx.canvas,0,0);ctx.clearRect(0,0,temp.width,temp.height);ctx.drawImage(temp,...op.offset);
  }
  ctx.restore();
}
export class Renderer {
  constructor() { this.layers=new Map();this.composites=new Map();this.onions=new Map();this.images=new Map();this.lru=new Map();this.pixelBudget=8*1024*1024;this.pixels=0; }
  clear(){this.layers.clear();this.composites.clear();this.onions.clear();this.images.clear();this.lru.clear();this.pixels=0;}
  async prepare(p) {
    const sources=new Set();for(const f of p.frames)for(const ops of Object.values(f.cells))for(const op of ops)if(op.kind==='image')sources.add(op.src);
    for(const src of sources)if(!this.images.has(src)) {const img=new Image();img.src=src;await img.decode();if(img.width>1280||img.height>1280)throw new Error('An imported picture is too large.');this.images.set(src,img);}
  }
  touch(key,map){this.lru.delete(key);this.lru.set(key,map);}
  remember(map,key,value){map.set(key,value);this.touch(key,map);this.pixels+=value.width*value.height;while(this.pixels>this.pixelBudget){const [k,victim]=this.lru.entries().next().value??[];if(k===undefined)break;const c=victim.get(k);this.pixels-=c.width*c.height;victim.delete(k);this.lru.delete(k);}return value;}
  layer(p,ops){
    if(this.layers.has(ops)){this.touch(ops,this.layers);return this.layers.get(ops);}
    const c=canvas(p.width,p.height),ctx=context(c);for(const op of ops)renderOperation(ctx,op,this.images);return this.remember(this.layers,ops,c);
  }
  frame(p,index,background=true,override=null){
    const f=p.frames[index],key=f;const signature=p.layers.map(l=>`${l.id}:${l.visible}:${l.opacity}`).join('/')+p.background;
    const cached=this.composites.get(key);if(!override&&background&&cached?.signature===signature){this.touch(key,this.composites);return cached;}
    if(cached&&(!override&&background)){this.pixels-=cached.width*cached.height;this.composites.delete(key);this.lru.delete(key);}
    const c=canvas(p.width,p.height);this.paint(context(c),p,index,background,override);
    if(background&&!override){c.signature=signature;this.remember(this.composites,key,c);}return c;
  }
  paint(ctx,p,index,background=true,override=null){
    ctx.clearRect(0,0,p.width,p.height);if(background){ctx.fillStyle=p.background;ctx.fillRect(0,0,p.width,p.height);}
    for(const l of [...p.layers].reverse())if(l.visible&&l.opacity>0){ctx.globalAlpha=l.opacity;ctx.drawImage(override?.id===l.id?override.canvas:this.layer(p,p.frames[index].cells[l.id]),0,0);}ctx.globalAlpha=1;
  }
  drawOnion(ctx,p,index,opacity=.22){
    const signature=p.layers.map(l=>`${l.id}:${l.visible}:${l.opacity}`).join('/');
    for(const [offset,color] of [[-1,'#e27687'],[1,'#55b9a0']]){
      const i=index+offset;if(i<0||i>=p.frames.length)continue;const f=p.frames[i],key=`onion:${f.id}:${color}`;let c=this.onions.get(key);
      if(!c||c.frameReference!==f||c.signature!==signature){
        if(c){this.pixels-=c.width*c.height;this.onions.delete(key);this.lru.delete(key);}
        c=this.frame(p,i,false);const s=context(c);s.globalCompositeOperation='source-in';s.fillStyle=color;s.fillRect(0,0,p.width,p.height);c.frameReference=f;c.signature=signature;this.remember(this.onions,key,c);
      }else this.touch(key,this.onions);
      ctx.globalAlpha=opacity;ctx.drawImage(c,0,0);
    }ctx.globalAlpha=1;
  }
}
