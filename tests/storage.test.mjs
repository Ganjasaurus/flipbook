import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { newProject, appendOperation, insertFrame, parseProject } from '../dist/model.js';
import { saveProject, loadProject, listProjects, deleteProject, closeStorage } from '../dist/storage.js';

test('device shelf saves exact editable content transactionally, isolates projects, and reopens',async()=>{
  let p=newProject();p.title='My saved animation';p=appendOperation(p,0,p.layers[0].id,{kind:'stroke',brush:'pencil',color:'#334455',size:9,opacity:.7,points:[[10,20,.4],[20,40,1]]});p=insertFrame(p,0,true);const other=newProject();
  await saveProject(p,'data:image/png;base64,AAAA');await saveProject(other,'data:image/png;base64,BBBB');p.frames[0].hold=4;
  let restored=await loadProject(p.id);assert.equal(restored.project.frames[0].hold,1);assert.equal(restored.project.frames.length,2);assert.doesNotThrow(()=>parseProject(JSON.stringify(restored.project)));
  closeStorage();restored=await loadProject(p.id);assert.equal(restored.project.title,'My saved animation');const shelf=await listProjects();assert.equal(shelf.length,2);assert(shelf.some(r=>r.title==='My saved animation'&&r.frameCount===2));assert(shelf.every(r=>!('project'in r)));
  await deleteProject(p.id);assert.equal(await loadProject(p.id),undefined);assert(await loadProject(other.id));await deleteProject(other.id);closeStorage();
});
