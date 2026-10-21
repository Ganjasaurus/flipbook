import test from 'node:test';
import assert from 'node:assert/strict';
import { newProject, appendOperation, insertFrame, removeFrame, moveFrame, addLayer, removeLayer, updateFrame, timeline, frameAtTime, History, validateProject, parseProject, projectUsage, uid, LIMITS } from '../dist/model.js';
import { starterProject } from '../dist/starter.js';
const stroke=()=>({kind:'stroke',brush:'pen',color:'#123456',size:8,opacity:1,points:[[10,20,.5],[30,40,1]]});

test('starter and every supported operation survive editable file round trips',()=>{
  let p=starterProject();const id=p.layers[0].id;
  for(const op of [stroke(),{kind:'shape',shape:'star',from:[5,5],to:[80,70],size:3,opacity:.8,color:'#55b9a0',fill:true},{kind:'fill',at:[0,0],color:'#ffffff'},{kind:'text',at:[4,8],size:32,text:'Hello <world> ✧',color:'#333333'},{kind:'transform',offset:[5,-10]}])p=appendOperation(p,0,id,op);
  const restored=parseProject(JSON.stringify(p));assert.deepEqual(JSON.parse(JSON.stringify(restored)),p);assert.notEqual(restored.frames[0].cells[id],p.frames[0].cells[id]);
});
test('duplicating a frame shares immutable drawings but editing and undo remain independent',()=>{
  let p=newProject(),id=p.layers[0].id;p=appendOperation(p,0,id,stroke());const original=p;
  p=insertFrame(p,0,true);assert.equal(p.frames[0].cells[id],p.frames[1].cells[id]);assert.notEqual(p.frames[0].id,p.frames[1].id);
  const history=new History();history.push(p);const duplicate=p;p=appendOperation(p,1,id,stroke());assert.equal(p.frames[0].cells[id].length,1);assert.equal(p.frames[1].cells[id].length,2);
  assert.equal(history.undo(p),duplicate);assert.equal(history.redo(duplicate),p);assert.equal(original.frames.length,1);
});
test('sound cues travel with reordered frames and deleting the last frame leaves a usable page',()=>{
  let p=newProject();p=updateFrame(p,0,{cues:[{sound:'pop',volume:.8}],hold:3});const id=p.frames[0].id;p=insertFrame(p,0);p=moveFrame(p,0,1);assert.equal(p.frames[1].id,id);assert.equal(p.frames[1].cues[0].sound,'pop');
  p=removeFrame(p,1);p=removeFrame(p,0);assert.equal(p.frames.length,1);assert.equal(p.frames[0].hold,1);assert.equal(p.frames[0].cues.length,0);assert.doesNotThrow(()=>validateProject(p));
});
test('frame timing honors holds, fps, looping, and the final non-looping frame',()=>{
  let p=newProject();p.fps=10;p=insertFrame(p,0);p=insertFrame(p,1);p=updateFrame(p,1,{hold:3});
  assert.deepEqual(timeline(p).map(e=>Math.round(e.duration*1000)),[100,300,100]);
  assert.equal(frameAtTime(p,.05),0);assert.equal(frameAtTime(p,.2),1);assert.equal(frameAtTime(p,.45),2);assert.equal(frameAtTime(p,.55),0);p.loop=false;assert.equal(frameAtTime(p,20),2);
});
test('layer add, order, and deletion keep every frame structurally valid',()=>{
  let p=insertFrame(newProject(),0);p=addLayer(p);const id=p.layers[0].id;assert(p.frames.every(f=>Array.isArray(f.cells[id])));p=removeLayer(p,id);assert(p.frames.every(f=>!Object.hasOwn(f.cells,id)));assert.doesNotThrow(()=>validateProject(p));
  while(p.layers.length>1)p=removeLayer(p,p.layers[0].id);assert.throws(()=>removeLayer(p,p.layers[0].id),/Keep one/);
});
test('history count and memory budgets discard old states and fresh edits clear redo',()=>{
  const h=new History(3,900);let p=newProject();for(let i=0;i<8;i++){h.push(p);p=appendOperation(p,0,p.layers[0].id,stroke());}assert(h.past.length<=3);const restored=h.undo(p);assert(h.future.length);h.push(restored);assert.equal(h.future.length,0);
});
test('imports reject malformed geometry, malicious objects, invalid sounds, and oversized projects atomically',()=>{
  const p=newProject(),mutations=[p=>p.width=100000,p=>p.fps=0,p=>p.layers[0].id='__proto__',p=>p.frames[0].hold=0,p=>p.frames.push(p.frames[0]),p=>p.frames[0].cues=[{sound:'missing',volume:1}],p=>p.recordings.evil={name:'bad',duration:1,data:'https://example.com/audio.mp3'},p=>p.frames[0].cells[p.layers[0].id]=[{...stroke(),id:uid(),points:[[NaN,0,.4]]}],p=>p.frames[0].cells[p.layers[0].id]=[{id:uid(),kind:'image',at:[0,0],width:50,height:50,src:'data:image/svg+xml;base64,PHN2Zz4='}]];
  for(const mutate of mutations){const bad=structuredClone(p);mutate(bad);assert.throws(()=>validateProject(bad));}assert.throws(()=>parseProject('{broken'));assert.throws(()=>parseProject(' '.repeat(LIMITS.fileBytes+1)));assert.equal(p.frames.length,1);
});
test('project usage accounts for duplicated imported images and recordings',()=>{
  let p=newProject();p=appendOperation(p,0,p.layers[0].id,{kind:'image',src:'data:image/png;base64,AAAA',at:[0,0],width:10,height:10});const one=projectUsage(p);p=insertFrame(p,0,true);assert.equal(projectUsage(p).imageBytes,one.imageBytes*2);
});
