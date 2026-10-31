import { canvas, context, stamp, strokeSegment, renderOperation } from './drawing.js';
import { BRUSHES, clamp } from './model.js';
import { allowContextMenu } from './console-kit.js';

export class Studio {
  constructor(viewport,paper,renderer,callbacks={}){
    this.viewport=viewport;this.paper=paper;this.renderer=renderer;this.callbacks=callbacks;this.ctx=context(paper);this.zoom=1;this.pan={x:0,y:0};this.pointers=new Map();this.drawing=null;this.gesture=null;this.raf=0;this.playing=false;this.space=false;this.onion=true;
    this.settings={tool:'pen',color:'#32243f',size:7,opacity:1,shape:'ellipse',fill:false,stabilize:true};
    viewport.addEventListener('pointerdown',e=>this.down(e));viewport.addEventListener('pointermove',e=>this.move(e));viewport.addEventListener('pointerup',e=>this.up(e));viewport.addEventListener('pointercancel',()=>this.cancelGesture());viewport.addEventListener('lostpointercapture',e=>{if(this.pointers.has(e.pointerId))this.cancelGesture();});viewport.addEventListener('contextmenu',e=>{if(!allowContextMenu())e.preventDefault();});
    viewport.addEventListener('wheel',e=>{e.preventDefault();if(this.playing)return;this.setZoom(this.zoom*Math.exp(-e.deltaY*.0015),e.clientX,e.clientY);},{passive:false});
    this.resizeObserver=new ResizeObserver(()=>this.fit());this.resizeObserver.observe(viewport);globalThis.window?.addEventListener?.('resize',()=>this.fit());
  }
  setProject(project,index,layer){const resize=!this.project||this.project.width!==project.width||this.project.height!==project.height;this.project=project;this.index=index;this.layer=layer;if(resize){this.paper.width=project.width;this.paper.height=project.height;this.fit();}this.requestDraw();}
  fit(){if(!this.project)return;const r=this.viewport.getBoundingClientRect();const padX=Math.min(64,Math.max(16,r.width*.08)),padY=Math.min(76,Math.max(20,r.height*.12));this.baseScale=r.width>0&&r.height>0?Math.max(.05,Math.min((r.width-padX)/this.project.width,(r.height-padY)/this.project.height)):1;this.transform();}
  transform(){const scale=(this.baseScale??1)*this.zoom;this.paper.style.width=`${this.project.width*scale}px`;this.paper.style.height=`${this.project.height*scale}px`;this.paper.style.transform=`translate(calc(-50% + ${this.pan.x}px), calc(-50% + ${this.pan.y}px))`;this.callbacks.onZoom?.(this.zoom);}
  setZoom(value,x,y){const next=clamp(value,.25,8),r=this.viewport.getBoundingClientRect(),cx=(x??r.left+r.width/2)-(r.left+r.width/2),cy=(y??r.top+r.height/2)-(r.top+r.height/2),ratio=next/this.zoom;this.pan.x=cx-(cx-this.pan.x)*ratio;this.pan.y=cy-(cy-this.pan.y)*ratio;this.zoom=next;this.transform();}
  resetView(){this.zoom=1;this.pan={x:0,y:0};this.fit();}
  point(e){const r=this.paper.getBoundingClientRect();return [clamp((e.clientX-r.left)/r.width*this.project.width,-8192,8192),clamp((e.clientY-r.top)/r.height*this.project.height,-8192,8192),e.pointerType==='pen'?clamp(e.pressure||.5,.05,1):.8];}
  down(e){
    if(this.playing||!this.project||this.callbacks.isBusy?.())return;if(e.pointerType==='mouse'&&e.button!==0&&e.button!==1&&e.button!==2)return;
    e.preventDefault();this.viewport.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.pointers.size===2){this.cancelStroke();const [a,b]=[...this.pointers.values()];this.gesture={type:'pinch',distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};return;}
    if(this.pointers.size>2||this.gesture)return;
    if(this.settings.tool==='hand'||this.space||e.button===1||e.button===2){this.gesture={type:'pan',last:{x:e.clientX,y:e.clientY}};return;}
    const point=this.point(e);if(point[0]<0||point[1]<0||point[0]>this.project.width||point[1]>this.project.height)return;
    if(this.settings.tool==='picker'){const c=this.renderer.frame(this.project,this.index),data=context(c).getImageData(Math.min(c.width-1,Math.floor(point[0])),Math.min(c.height-1,Math.floor(point[1])),1,1).data;this.callbacks.onColor?.('#'+[...data.slice(0,3)].map(n=>n.toString(16).padStart(2,'0')).join(''));return;}
    const layer=this.project.layers.find(l=>l.id===this.layer);if(!layer?.visible||layer.opacity===0){this.callbacks.onMessage?.('Show this layer before drawing on it.');return;}
    if(this.settings.tool==='fill'){this.callbacks.onCommit?.({kind:'fill',at:point.slice(0,2),color:this.settings.color});return;}
    if(this.settings.tool==='text'){this.callbacks.onText?.(point.slice(0,2));return;}
    const buffer=canvas(this.project.width,this.project.height);context(buffer).drawImage(this.renderer.layer(this.project,this.project.frames[this.index].cells[this.layer]),0,0);
    const tool=this.settings.tool,base={color:this.settings.color,size:this.settings.size,opacity:this.settings.opacity};
    const op=Object.hasOwn(BRUSHES,tool)?{kind:'stroke',brush:tool,...base,points:[point]}:tool==='shape'?{kind:'shape',shape:this.settings.shape,...base,from:point.slice(0,2),to:point.slice(0,2),fill:this.settings.fill}:{kind:'transform',offset:[0,0]};
    this.drawing={pointerId:e.pointerId,op,buffer,ctx:context(buffer),origin:point};
    if(op.kind==='stroke')stamp(this.drawing.ctx,op,point);this.requestDraw();
  }
  move(e){
    if(!this.pointers.has(e.pointerId))return;this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(this.gesture?.type==='pinch'&&this.pointers.size>=2){
      const [a,b]=[...this.pointers.values()],center={x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance=Math.hypot(a.x-b.x,a.y-b.y),old=this.gesture;
      this.setZoom(this.zoom*distance/Math.max(1,old.distance),old.center.x,old.center.y);this.pan.x+=center.x-old.center.x;this.pan.y+=center.y-old.center.y;this.transform();this.gesture={type:'pinch',distance,center};return;
    }
    if(this.gesture?.type==='pan'){this.pan.x+=e.clientX-this.gesture.last.x;this.pan.y+=e.clientY-this.gesture.last.y;this.gesture.last={x:e.clientX,y:e.clientY};this.transform();return;}
    if(this.gesture||!this.drawing||this.drawing.pointerId!==e.pointerId)return;
    const drawing=this.drawing,op=drawing.op;
    if(op.kind==='stroke'){
      const events=e.getCoalescedEvents?.();for(const sample of events?.length?events:[e]){
        const raw=this.point(sample),last=op.points.at(-1);let point=raw;
        if(this.settings.stabilize)point=[last[0]+(raw[0]-last[0])*.72,last[1]+(raw[1]-last[1])*.72,raw[2]];
        point[0]=clamp(point[0],-1000,this.project.width+1000);point[1]=clamp(point[1],-1000,this.project.height+1000);
        if(Math.hypot(point[0]-last[0],point[1]-last[1])<.4)continue;
        if(op.points.length>=12000)break;op.points.push(point);strokeSegment(drawing.ctx,op,last,point,op.points.length-1);
      }
    }else{
      const p=this.point(e);if(op.kind==='shape')op.to=p.slice(0,2);else op.offset=[p[0]-drawing.origin[0],p[1]-drawing.origin[1]];
      drawing.ctx.clearRect(0,0,this.project.width,this.project.height);drawing.ctx.drawImage(this.renderer.layer(this.project,this.project.frames[this.index].cells[this.layer]),0,0);renderOperation(drawing.ctx,op,this.renderer.images);
    }this.requestDraw();
  }
  up(e){
    if(!this.pointers.has(e.pointerId))return;
    if(this.drawing?.pointerId===e.pointerId&&!this.gesture){this.move(e);const {op}=this.drawing;this.drawing=null;this.callbacks.onCommit?.(op);}
    this.pointers.delete(e.pointerId);if(this.pointers.size===0)this.gesture=null;else if(this.gesture)this.gesture={type:'waiting'};
    if(this.viewport.hasPointerCapture(e.pointerId))this.viewport.releasePointerCapture(e.pointerId);this.requestDraw();
  }
  cancelStroke(){this.drawing=null;this.requestDraw();}
  cancelGesture(){this.cancelStroke();this.pointers.clear();this.gesture=null;}
  requestDraw(){if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw();});}
  draw(){
    if(!this.project)return;const p=this.project,ctx=this.ctx;ctx.clearRect(0,0,p.width,p.height);ctx.fillStyle=p.background;ctx.fillRect(0,0,p.width,p.height);
    if(this.onion&&!this.playing)this.renderer.drawOnion(ctx,p,this.index);
    const override=this.drawing?{id:this.layer,canvas:this.drawing.buffer}:null;
    for(const l of [...p.layers].reverse())if(l.visible&&l.opacity>0){ctx.globalAlpha=l.opacity;ctx.drawImage(override?.id===l.id?override.canvas:this.renderer.layer(p,p.frames[this.index].cells[l.id]),0,0);}ctx.globalAlpha=1;
  }
}
