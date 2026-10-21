import { newProject, blankFrame, uid } from './model.js';
export function starterProject() {
  const p=newProject();p.title='A little happy bounce';p.fps=10;
  const ink=p.layers[0].id,color=p.layers[1].id;
  const stroke=(points,size=6,col='#32243f')=>({id:uid(),kind:'stroke',brush:'pen',color:col,size,opacity:1,points:points.map(a=>[...a,.8])});
  const ellipse=(x,y,w,h,col)=>({id:uid(),kind:'shape',shape:'ellipse',from:[x,y],to:[x+w,y+h],color:col,size:3,opacity:1,fill:true});
  p.frames=Array.from({length:12},(_,i)=>{
    const f=blankFrame(p.layers),t=i/12*Math.PI*2,lift=(1-Math.cos(t))*65,cy=337-lift,squash=i===0?1.17:1,rx=86*squash,ry=88/squash;
    f.cells[color]=[
      ellipse(347,442,266,19,'#e9e0ef'),
      ellipse(480-rx,cy-ry,rx*2,ry*2,'#ffad57'),
      ellipse(480-rx+14,cy+2,31,15,'#f58770'),ellipse(480+rx-45,cy+2,31,15,'#f58770')
    ];
    const smile=Array.from({length:21},(_,j)=>{const a=j/20*Math.PI;return [480-24*Math.cos(a),cy+9+18*Math.sin(a)];});
    f.cells[ink]=[
      stroke([[452,cy-16],[452,cy-5]],7),stroke([[508,cy-16],[508,cy-5]],7),stroke(smile,5),
      stroke([[480-rx+4,cy-5],[480-rx-18,cy+9],[480-rx-26,cy+1]],5),stroke([[480+rx-4,cy-5],[480+rx+18,cy-19],[480+rx+24,cy-31]],5),
      stroke([[455,cy+ry-5],[448,cy+ry+18],[432,cy+ry+18]],6),stroke([[505,cy+ry-5],[512,cy+ry+18],[528,cy+ry+18]],6),
      {id:uid(),kind:'shape',shape:'star',from:[284,186],to:[311,213],color:'#a58bd6',size:3,opacity:1,fill:false},
      stroke([[653,263],[666,263]],4,'#55b9a0'),stroke([[659,257],[659,269]],4,'#55b9a0'),
      {id:uid(),kind:'shape',shape:'ellipse',from:[622,160],to:[632,170],color:'#f58770',size:3,opacity:1,fill:false}
    ];
    if(i===0)f.cues=[{sound:'boing',volume:.55}];return f;
  });return p;
}
