import { BRUSHES, PALETTE, LIMITS, SFX, History, newProject, appendOperation, insertFrame, removeFrame, moveFrame, addLayer, removeLayer, updateFrame, timeline, frameAtTime, validateProject, parseProject, projectUsage, clamp, uid } from './model.js';
import { Renderer, canvas, context, renderOperation } from './drawing.js';
import { Studio } from './studio.js';
import { starterProject } from './starter.js';
import { AudioStudio, Microphone } from './audio.js';
import { saveProject, listProjects, loadProject, deleteProject } from './storage.js';
import { download, filename, png, exportGIF, exportVideo, exportFrames, videoType } from './export.js';

const $=id=>document.getElementById(id),icon=name=>`<svg aria-hidden="true"><use href="./icons.svg#${name}"/></svg>`;
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const renderer=new Renderer(),audio=new AudioStudio(),mic=new Microphone(),history=new History();
let project=newProject(),index=0,layer=project.layers[0].id,brush='pen',revision=0,savedRevision=-1,backupRevision=-1,saveTimer=0,saveChain=Promise.resolve(),toastTimer=0,playing=false,playRaf=0,playStart=0,playOffset=0,playSession=0,busy=false,exportController=null,modalCleanup=null,ready=false;
const brushSizes=Object.fromEntries(Object.entries(BRUSHES).map(([id,info])=>[id,info.size]));
const frameNodes=new Map();let thumbnailGeneration=0;
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4400);}
function errorMessage(error){if(error?.name==='AbortError')toast('Export cancelled. Your flipbook is safe.');else toast(error?.message??'Something went wrong. Please try again.');}
const studio=new Studio($('viewport'),$('paper'),renderer,{
  onCommit:operation=>{try{commit(appendOperation(project,index,layer,operation));}catch(error){studio.requestDraw();errorMessage(error);}},
  onColor:color=>{setColor(color);selectTool('draw');},onText:at=>openText(at),onMessage:toast,onZoom:value=>$('zoom-reset').textContent=`${Math.round(value*100)}%`,isBusy:()=>busy||!ready
});

function commit(next){
  if(next===project)return;const usage=projectUsage(next);if(usage.operations>LIMITS.operations||usage.points>LIMITS.points||usage.imageBytes>LIMITS.imageBytes||usage.audioBytes>LIMITS.audioBytes||usage.estimatedBytes>LIMITS.fileBytes)throw new Error('This flipbook is getting full. Save it and start a new chapter.');
  stopPlayback();studio.cancelStroke();history.push(project);project=next;revision++;index=clamp(index,0,project.frames.length-1);if(!project.layers.some(l=>l.id===layer))layer=project.layers[0].id;render();scheduleSave();
}
function editFrame(update){commit(updateFrame(project,index,update));}
function scheduleSave(){clearTimeout(saveTimer);$('save-status').innerHTML='<i></i>Keeping your changes…';saveTimer=setTimeout(()=>saveNow().catch(errorMessage),750);}
function thumbnail(p){const c=canvas(192,Math.round(192*p.height/p.width));context(c).drawImage(renderer.frame(p,0),0,0,c.width,c.height);return c.toDataURL('image/png');}
function saveNow(){
  clearTimeout(saveTimer);if(savedRevision===revision)return saveChain;
  const snapshot=project,version=revision;
  saveChain=saveChain.catch(()=>{}).then(async()=>{
    try{await saveProject(snapshot,thumbnail(snapshot));if(snapshot.id===project.id&&version===revision){savedRevision=version;$('save-status').innerHTML='<i></i>Saved on this device';}}
    catch(error){if(snapshot.id===project.id){$('save-status').textContent='Download a file to keep it';}throw new Error('Device saving is unavailable or full. Use Keep it → Editable flipbook to save a backup.');}
  });return saveChain;
}
async function preserveCurrent(){if(savedRevision===revision)return;try{await saveNow();}catch{if(backupRevision===revision)return;openExport();throw new Error('Download an editable flipbook before opening another, so this one is safe.');}}
async function replaceProject(next,{preserve=true}={}){
  const checked=validateProject(next),prepared=new Renderer();await prepared.prepare(checked);if(preserve)await preserveCurrent();
  stopPlayback();studio.cancelGesture();audio.clear();renderer.clear();renderer.images=prepared.images;project=checked;index=0;layer=project.layers[0].id;history.clear();revision++;savedRevision=-1;backupRevision=-1;frameNodes.clear();$('filmstrip').replaceChildren();closeModal();render();studio.resetView();scheduleSave();
}

function setColor(color){studio.settings.color=color;$('custom-color').value=color;for(const el of $('swatches').children)el.setAttribute('aria-pressed',el.dataset.color===color);drawBrushPreview();}
function syncSizeControl(value){const next=clamp(Math.round(Number(value)||studio.settings.size),1,100);studio.settings.size=next;if(Object.hasOwn(BRUSHES,studio.settings.tool))brushSizes[studio.settings.tool]=next;else brushSizes[brush]=next;$('size').value=String(next);$('size-value').textContent=`${next} px`;drawBrushPreview();}
function selectTool(tool){
  stopPlayback();studio.cancelGesture();if(tool==='draw')tool=brush;studio.settings.tool=tool;$('viewport').dataset.tool=tool;if(Object.hasOwn(BRUSHES,tool)){const nextSize=brushSizes[tool]??BRUSHES[tool].size;studio.settings.size=nextSize;$('size').value=String(nextSize);$('size-value').textContent=`${nextSize} px`;}
  const main=Object.hasOwn(BRUSHES,tool)&&tool!=='eraser'?'draw':tool;
  document.querySelectorAll('[data-tool]').forEach(el=>{if(!el.classList.contains('tool'))return;const active=el.dataset.tool===main;el.classList.toggle('active',active);el.setAttribute('aria-pressed',active);});
  const info=BRUSHES[tool]??{name:{fill:'Color fill',shape:'Little shapes',text:'Say something',picker:'Color picker',hand:'Move the view',move:'Move this layer'}[tool]??'Drawing tool',hint:{fill:'Fill a closed space on this layer',shape:'Drag to make a shape',text:'Tap the paper to add words',picker:'Tap a color on your drawing',hand:'Drag to pan. Pinch to zoom.',move:'Drag to move all art on this layer'}[tool]??''};
  $('tool-name').textContent=info.name;$('tool-hint').textContent=info.hint;$('shape-options').hidden=tool!=='shape';$('brush-grid').hidden=!Object.hasOwn(BRUSHES,tool)||tool==='eraser';
  for(const el of $('brush-grid').children)el.setAttribute('aria-pressed',el.dataset.brush===tool);
  drawBrushPreview();
}
function drawBrushPreview(){const c=$('brush-preview'),ctx=context(c);ctx.clearRect(0,0,c.width,c.height);const points=Array.from({length:65},(_,i)=>[18+i*5,34+Math.sin(i/64*Math.PI*2)*10,.7]);renderOperation(ctx,{kind:'stroke',brush:Object.hasOwn(BRUSHES,studio.settings.tool)?studio.settings.tool==='eraser'?'pen':studio.settings.tool:'pen',color:studio.settings.color,size:Math.min(40,studio.settings.size),opacity:studio.settings.opacity,points});}
function render(){
  studio.setProject(project,index,layer);$('project-title').value=project.title;$('paper-color').value=project.background;$('paper-caption').textContent=`${project.title} · ${project.width} × ${project.height}`;
  $('undo').disabled=!history.past.length;$('redo').disabled=!history.future.length;
  if(!$('fps').querySelector(`option[value="${project.fps}"]`)){$('fps').add(new Option(`${project.fps} fps`,String(project.fps)));}$('fps').value=String(project.fps);$('loop').setAttribute('aria-pressed',project.loop);
  $('frame-count').textContent=`${project.frames.length} frame${project.frames.length===1?'':'s'}`;$('duration').textContent=`${timeline(project).at(-1).end.toFixed(1)} seconds of possibility`;
  renderTimeline();renderLayers();renderSelection();
}
function renderSelection(){
  $('frame-position').textContent=`FRAME ${String(index+1).padStart(2,'0')} OF ${String(project.frames.length).padStart(2,'0')}`;
  for(const [id,node] of frameNodes){const active=project.frames[index].id===id;node.button.classList.toggle('active',active);node.button.setAttribute('aria-current',active?'true':'false');}
}
function renderTimeline(){
  const generation=++thumbnailGeneration,ids=new Set(project.frames.map(f=>f.id));for(const [id,node] of frameNodes)if(!ids.has(id)){node.button.remove();frameNodes.delete(id);}
  const signature=project.background+project.layers.map(l=>`${l.id}/${l.visible}/${l.opacity}`).join('');const queue=[];
  project.frames.forEach((frame,i)=>{
    let node=frameNodes.get(frame.id);
    if(!node){const button=document.createElement('button');button.className='frame';button.type='button';button.draggable=true;button.setAttribute('role','listitem');const thumb=canvas(160,100),meta=document.createElement('span');meta.className='frame-meta';button.append(thumb,meta);
      button.addEventListener('click',()=>selectFrame(project.frames.findIndex(f=>f.id===frame.id)));
      button.addEventListener('dragstart',e=>{stopPlayback();e.dataTransfer.setData('text/flipbook-frame',frame.id);e.dataTransfer.effectAllowed='move';});
      button.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('text/flipbook-frame'))e.preventDefault();});
      button.addEventListener('drop',e=>{e.preventDefault();const from=project.frames.findIndex(f=>f.id===e.dataTransfer.getData('text/flipbook-frame')),to=project.frames.findIndex(f=>f.id===frame.id);if(from>=0&&to>=0){const next=moveFrame(project,from,to);index=to;commit(next);}});
      node={button,thumb,meta,frame:null,signature:null};frameNodes.set(frame.id,node);
    }
    node.button.setAttribute('aria-label',`Frame ${i+1}${frame.cues.length?', has sound':''}, hold ${frame.hold}`);node.meta.innerHTML=`<span>${String(i+1).padStart(2,'0')}</span>${frame.hold>1?`<span class="frame-hold">×${frame.hold}</span>`:''}${frame.cues.length?icon('music'):''}`;
    const current=$('filmstrip').children[i];if(current!==node.button)$('filmstrip').insertBefore(node.button,current??null);
    if(node.frame!==frame||node.signature!==signature){queue.push({node,i,frame});}
  });
  // Thumbnails are batched outside pointer events so long timelines stay responsive.
  function batch(){if(generation!==thumbnailGeneration)return;const started=performance.now();while(queue.length&&performance.now()-started<7){const {node,i,frame}=queue.shift(),ctx=context(node.thumb);ctx.clearRect(0,0,160,100);const scale=Math.min(160/project.width,100/project.height),w=project.width*scale,h=project.height*scale;ctx.drawImage(renderer.frame(project,i),(160-w)/2,(100-h)/2,w,h);node.frame=frame;node.signature=signature;}if(queue.length)requestAnimationFrame(batch);}
  requestAnimationFrame(batch);
}
function renderLayers(){
  $('layers').replaceChildren();for(const l of project.layers){const row=document.createElement('div');row.className='layer'+(l.id===layer?' active':'');const select=document.createElement('button');select.className='layer-select';select.setAttribute('aria-label',`Draw on ${l.name}`);select.setAttribute('aria-pressed',l.id===layer);const thumb=canvas(66,50),ctx=context(thumb);ctx.drawImage(renderer.layer(project,project.frames[index].cells[l.id]),0,0,66,50);const label=document.createElement('span');label.textContent=l.name;select.append(thumb,label);select.addEventListener('click',()=>{studio.cancelGesture();layer=l.id;studio.setProject(project,index,layer);renderLayers();});
    const visibility=document.createElement('button');visibility.className='icon-button small';visibility.setAttribute('aria-label',`${l.visible?'Hide':'Show'} ${l.name}`);visibility.innerHTML=icon(l.visible?'eye':'eye-off');visibility.addEventListener('click',()=>commit({...project,layers:project.layers.map(item=>item.id===l.id?{...item,visible:!item.visible}:item)}));row.append(select,visibility);$('layers').append(row);
  }$('add-layer').disabled=project.layers.length>=LIMITS.layers;
}
function selectFrame(next){if(next<0||next>=project.frames.length)return;stopPlayback();studio.cancelGesture();index=next;studio.setProject(project,index,layer);renderSelection();renderLayers();frameNodes.get(project.frames[index].id)?.button.scrollIntoView({block:'nearest',inline:'nearest'});}
function restoreHistory(redo=false){stopPlayback();studio.cancelGesture();project=redo?history.redo(project):history.undo(project);index=clamp(index,0,project.frames.length-1);if(!project.layers.some(l=>l.id===layer))layer=project.layers[0].id;revision++;render();scheduleSave();}
async function startPlayback(){
  if(playing){stopPlayback();return;}studio.cancelGesture();playing=true;studio.playing=true;const session=++playSession;playOffset=timeline(project)[index].start;
  $('app').classList.add('is-playing');$('play').innerHTML=icon('pause')+'<span>Pause</span>';$('play').setAttribute('aria-label','Pause animation');$('play').setAttribute('aria-pressed','true');
  try{if(audio.enabled)await audio.play(project,{start:playOffset});}catch(error){toast(error.message);}
  if(!playing||session!==playSession)return;playStart=performance.now();const duration=timeline(project).at(-1).end;
  const tick=now=>{if(!playing)return;const elapsed=(now-playStart)/1000+playOffset;if(!project.loop&&elapsed>=duration){index=project.frames.length-1;stopPlayback();return;}const next=frameAtTime(project,elapsed);if(next!==index){index=next;studio.index=index;studio.requestDraw();renderSelection();const node=frameNodes.get(project.frames[index].id)?.button;if(node){const r=node.getBoundingClientRect(),strip=$('filmstrip').getBoundingClientRect();if(r.left<strip.left||r.right>strip.right)node.scrollIntoView({block:'nearest',inline:'nearest'});}}playRaf=requestAnimationFrame(tick);};studio.requestDraw();playRaf=requestAnimationFrame(tick);
}
function stopPlayback(){playSession++;cancelAnimationFrame(playRaf);audio.stop();if(!playing)return;playing=false;studio.playing=false;$('app').classList.remove('is-playing');$('play').innerHTML=icon('play')+'<span>Play</span>';$('play').setAttribute('aria-label','Play animation');$('play').setAttribute('aria-pressed','false');studio.index=index;studio.requestDraw();renderSelection();renderLayers();}

function openModal(title,body,eyebrow='A LITTLE MORE MAGIC'){
  stopPlayback();studio.cancelGesture();modalCleanup?.();modalCleanup=null;$('modal-title')?.remove();$('modal-eyebrow').textContent=eyebrow;$('modal-content').innerHTML=`<h2 id="modal-title">${escape(title)}</h2>${body}`;if(!$('modal').open)$('modal').showModal();
}
function closeModal(){if(busy){exportController?.abort();}modalCleanup?.();modalCleanup=null;mic.stop(true);if($('modal').open)$('modal').close();}
function openText(at){openModal('A few little words.',`<p>Tap the paper with the Text tool to place your words.</p><label class="field-label" for="text-content">Your words</label><textarea id="text-content" maxlength="200" placeholder="Once upon a doodle…"></textarea><label class="field-label" for="text-size">Letter size</label><input id="text-size" type="range" min="12" max="120" value="40"><div class="modal-actions"><button id="place-text" class="button primary">Add to this frame</button></div>`);$('text-content').focus();$('place-text').onclick=()=>{const text=$('text-content').value.trim();if(!text)return;commit(appendOperation(project,index,layer,{kind:'text',text,at,size:Number($('text-size').value),color:studio.settings.color}));closeModal();};}
function openFrameOptions(){
  const frame=project.frames[index];openModal(`Frame ${index+1}, your way.`,`<p>A longer hold gives a moment room to breathe. Move frames to change your story.</p><div class="range-heading"><label for="frame-hold">Hold this frame</label><output id="hold-value">${frame.hold} beat${frame.hold===1?'':'s'}</output></div><input id="frame-hold" type="range" min="1" max="24" value="${frame.hold}"><div class="modal-actions"><button id="move-earlier" class="button" ${index===0?'disabled':''}>← Move earlier</button><button id="move-later" class="button" ${index===project.frames.length-1?'disabled':''}>Move later →</button></div><div class="modal-actions"><button id="apply-frame" class="button primary">Done</button></div>`);
  $('frame-hold').oninput=e=>$('hold-value').textContent=`${e.target.value} beats`;$('apply-frame').onclick=()=>{editFrame({hold:Number($('frame-hold').value)});closeModal();};
  for(const [id,direction]of[['move-earlier',-1],['move-later',1]])$(id).onclick=()=>{const next=moveFrame(project,index,index+direction);index+=direction;commit(next);openFrameOptions();};
}
function confirmDeleteFrame(){openModal('Let this frame go?',`<p>Frame ${index+1} will be removed. You can always bring it back with Undo.</p><div class="modal-actions"><button id="cancel-delete" class="button">Keep it</button><button id="confirm-delete" class="button danger">Delete frame</button></div>`);$('cancel-delete').onclick=closeModal;$('confirm-delete').onclick=()=>{commit(removeFrame(project,index));closeModal();};}
function openLayerOptions(){
  const l=project.layers.find(l=>l.id===layer),position=project.layers.indexOf(l);
  openModal('A little layer magic.',`<label class="field-label" for="layer-name">Layer name</label><input type="text" id="layer-name" maxlength="40" value="${escape(l.name)}"><div class="range-heading"><label for="layer-opacity">Layer opacity</label><output id="layer-opacity-value">${Math.round(l.opacity*100)}%</output></div><input id="layer-opacity" type="range" min="0" max="100" value="${Math.round(l.opacity*100)}"><p>Layer names, order, visibility, and opacity apply to every frame. Moving or clearing art changes only this frame.</p><div class="modal-actions"><button id="layer-up" class="button" ${position===0?'disabled':''}>↑ Move up</button><button id="layer-down" class="button" ${position===project.layers.length-1?'disabled':''}>↓ Move down</button></div><div class="modal-actions"><button id="move-art" class="button">${icon('move')}Move art</button><button id="clear-layer" class="button">Clear this frame</button></div><div class="modal-actions"><button id="delete-layer" class="button danger" ${project.layers.length===1?'disabled':''}>Delete layer</button><button id="apply-layer" class="button primary">Done</button></div>`);
  $('layer-opacity').oninput=e=>$('layer-opacity-value').textContent=`${e.target.value}%`;
  const apply=()=>commit({...project,layers:project.layers.map(item=>item.id===layer?{...item,name:$('layer-name').value.trim()||'Layer',opacity:Number($('layer-opacity').value)/100}:item)});
  $('apply-layer').onclick=()=>{apply();closeModal();};$('move-art').onclick=()=>{apply();closeModal();selectTool('move');toast('Drag the drawing to move this layer. Undo brings cropped art back.');};
  $('clear-layer').onclick=()=>{editFrame({cells:{...project.frames[index].cells,[layer]:[]}});closeModal();toast('This layer is clear on this frame. Undo brings it back.');};
  $('delete-layer').onclick=()=>{openModal('Delete this layer?',`<p>This removes “${escape(l.name)}” from every frame. Undo can bring it back.</p><div class="modal-actions"><button id="keep-layer" class="button">Keep layer</button><button id="remove-layer" class="button danger">Delete from all frames</button></div>`);$('keep-layer').onclick=openLayerOptions;$('remove-layer').onclick=()=>{commit(removeLayer(project,layer));closeModal();};};
  for(const [id,delta]of[['layer-up',-1],['layer-down',1]])$(id).onclick=()=>{const layers=[...project.layers];[layers[position],layers[position+delta]]=[layers[position+delta],layers[position]];commit({...project,layers});openLayerOptions();};
}
function openNew(){
  openModal('What will you bring to life?',`<p>Your current flipbook stays on your shelf. Pick a fresh page, or play with a little bounce.</p><div class="starter-grid"><button class="starter-card" data-new="960,600"><span>▱</span><strong>A wide little world</strong><small>960 × 600 · landscape</small></button><button class="starter-card" data-new="720,720"><span>□</span><strong>Hip to be square</strong><small>720 × 720 · square</small></button><button class="starter-card" data-new="600,900"><span>▯</span><strong>A tall tale</strong><small>600 × 900 · portrait</small></button><button class="starter-card" data-new="starter"><span>☺</span><strong>A happy little bounce</strong><small>An editable 12-frame starter</small></button></div>`);
  document.querySelectorAll('[data-new]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const value=button.dataset.new;await replaceProject(value==='starter'?starterProject():newProject(...value.split(',').map(Number)));toast('A fresh page. A brand-new possibility.');}catch(error){button.disabled=false;errorMessage(error);}});
}
async function openShelf(){
  openModal('Your little collection.','<p>Saved on this device. Download an editable flipbook to keep a backup or move it to another device.</p><div id="shelf-items" class="shelf-grid"></div><div class="modal-actions"><button id="open-file" class="button">Open a .flipbook file</button><button id="shelf-new" class="button primary">New flipbook</button></div>','MADE BY YOU');
  $('open-file').onclick=()=>$('project-file').click();$('shelf-new').onclick=openNew;
  try{await saveNow();const records=await listProjects();if(!$('shelf-items'))return;
    if(!records.length){$('shelf-items').innerHTML='<div class="empty-state"><p>Your stories will appear here.</p></div>';return;}
    for(const record of records){const item=document.createElement('div');item.className='shelf-item';const open=document.createElement('button'),img=document.createElement('img');img.src=record.thumbnail;img.alt='';const info=document.createElement('span');info.className='shelf-info';const title=document.createElement('span');title.textContent=record.title;const meta=document.createElement('small');meta.textContent=`${record.frameCount} frames · ${new Date(record.updated).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;info.append(title,meta);open.append(img,info);open.onclick=async()=>{try{const loaded=await loadProject(record.id);if(!loaded)throw new Error('That flipbook is no longer on this device.');await replaceProject(loaded.project);}catch(error){errorMessage(error);}};const remove=document.createElement('button');remove.className='icon-button small shelf-delete';remove.setAttribute('aria-label',`Delete ${record.title}`);remove.innerHTML=icon('trash');remove.disabled=record.id===project.id;remove.onclick=()=>{openModal('Remove this flipbook?',`<p>“${escape(record.title)}” will be removed from this device. A downloaded .flipbook file can restore it.</p><div class="modal-actions"><button id="keep-saved" class="button">Keep it</button><button id="delete-saved" class="button danger">Delete saved flipbook</button></div>`);$('keep-saved').onclick=openShelf;$('delete-saved').onclick=async()=>{try{await deleteProject(record.id);await openShelf();}catch(error){errorMessage(error);}};};item.append(open,remove);$('shelf-items').append(item);}
  }catch(error){errorMessage(error);if($('shelf-items'))$('shelf-items').innerHTML='<div class="empty-state"><p>Device storage is unavailable. You can still download and open editable files.</p></div>';}
}
function projectDownload(){const text=JSON.stringify(project);if(text.length>LIMITS.fileBytes)throw new Error('This project is over 32 MB. Remove unused recordings or some picture frames before exporting.');download(new Blob([text],{type:'application/json'}),`${filename(project)}.flipbook`);backupRevision=revision;toast('Your editable flipbook is ready to keep.');}
function openExport(){
  openModal('Made something? Keep it.',`<p>Little ideas deserve a life outside the studio.</p><div class="export-list"><button class="export-card main-export" data-export="project">${icon('folder')}<span><strong>Editable flipbook</strong><small>All frames, layers, and sounds. Open it here again.</small></span>${icon('chevron')}</button><button class="export-card" data-export="gif">${icon('frames')}<span><strong>Animated GIF</strong><small>A shareable animation · 640 px wide · no sound</small></span>${icon('chevron')}</button><button class="export-card" data-export="video" ${videoType()&&HTMLCanvasElement.prototype.captureStream?'':'disabled'}>${icon('play')}<span><strong>Video with sound</strong><small>${videoType()&&HTMLCanvasElement.prototype.captureStream?'WebM or MP4, depending on your browser':'Not supported here · GIF and frames still work'}</small></span>${icon('chevron')}</button><button class="export-card" data-export="png">${icon('image')}<span><strong>This frame as a picture</strong><small>Full-size PNG · frame ${index+1}</small></span>${icon('chevron')}</button><button class="export-card" data-export="frames">${icon('duplicate')}<span><strong>Every frame</strong><small>Full-size PNG pictures + timing notes, in a ZIP</small></span>${icon('chevron')}</button><button class="export-card" data-export="wav">${icon('music')}<span><strong>Animation soundtrack</strong><small>All sound cues mixed into a WAV audio file</small></span>${icon('chevron')}</button></div><p class="export-note">Device saves live in this browser. Download an editable file for a lasting backup. GIF uses up to 256 colors per frame.</p>`,'LET YOUR IDEAS OUT');
  document.querySelectorAll('[data-export]').forEach(button=>button.onclick=()=>runExport(button.dataset.export));
}
async function runExport(type){
  try{
    if(type==='project'){projectDownload();return;}if(type==='png'){download(await png(renderer.frame(project,index)),`${filename(project)}-frame-${index+1}.png`);toast('Your picture is ready.');return;}
    const p=project;exportController=new AbortController();const signal=exportController.signal;
    openModal('A little export magic…',`<p>${type==='video'?'Keep this window open. Video export takes as long as your animation.':'Putting your little story together.'}</p><progress class="progress" id="export-progress" max="1" value="0"></progress><p id="export-detail" role="status">Getting ready…</p><div class="modal-actions"><button id="cancel-export" class="button">Cancel export</button></div>`);busy=true;$('app').classList.add('is-busy');$('cancel-export').onclick=()=>exportController.abort();
    const onProgress=value=>{if($('export-progress'))$('export-progress').value=value;if($('export-detail'))$('export-detail').textContent=`${Math.round(value*100)}% ready`;};
    let blob,extension=type;
    if(type==='gif')blob=await exportGIF(p,renderer,{onProgress,signal});
    if(type==='frames'){blob=await exportFrames(p,renderer,{onProgress,signal});extension='zip';}
    if(type==='video'){const result=await exportVideo(p,renderer,audio,{onProgress,signal});blob=result.blob;extension=result.extension;}
    if(type==='wav'){blob=await audio.mix(p);onProgress(1);}
    if(signal.aborted)throw new DOMException('Export cancelled','AbortError');download(blob,`${filename(p)}.${extension}`);busy=false;closeModal();toast('Your little story is ready to share.');
  }catch(error){busy=false;closeModal();errorMessage(error);}finally{busy=false;exportController=null;$('app').classList.remove('is-busy');studio.requestDraw();}
}

const soundNames={pop:'Pop',boing:'Boing',sparkle:'Sparkle',whoosh:'Whoosh',drum:'Drum',chirp:'Chirp'},soundGlyphs={pop:'◌',boing:'〰',sparkle:'✧',whoosh:'≋',drum:'◉',chirp:'♪'};
function addCue(sound){try{const cues=project.frames[index].cues;if(cues.length>=8)throw new Error('This frame has eight sounds already. Remove one to make room.');editFrame({cues:[...cues,{sound,volume:.7}]});renderSoundCues();toast(`Sound added to frame ${index+1}.`);}catch(error){errorMessage(error);}}
function renderSoundCues(){
  const root=$('sound-cues');if(!root)return;root.innerHTML='';if(!project.frames[index].cues.length){root.innerHTML='<p class="export-note">No sounds on this frame yet. Tap + Add below a sound.</p>';return;}
  project.frames[index].cues.forEach((cue,i)=>{const row=document.createElement('div');row.className='sound-cue';const preview=document.createElement('button');preview.className='icon-button small';preview.innerHTML=icon('play');preview.setAttribute('aria-label','Preview sound');preview.onclick=()=>audio.preview(cue.sound,project).catch(errorMessage);const label=document.createElement('span');label.textContent=soundNames[cue.sound]??project.recordings[cue.sound]?.name??'My sound';const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.value=String(Math.round(cue.volume*100));volume.setAttribute('aria-label',`Volume for ${label.textContent}`);volume.onchange=()=>editFrame({cues:project.frames[index].cues.map((c,j)=>j===i?{...c,volume:Number(volume.value)/100}:c)});const remove=document.createElement('button');remove.className='icon-button small';remove.innerHTML=icon('close');remove.setAttribute('aria-label','Remove sound from frame');remove.onclick=()=>{editFrame({cues:project.frames[index].cues.filter((_,j)=>j!==i)});renderSoundCues();};row.append(preview,label,volume,remove);root.append(row);});
}
function renderRecordings(){const root=$('recordings');if(!root)return;root.innerHTML='';for(const [id,r]of Object.entries(project.recordings)){const item=document.createElement('div');item.className='recording-item';const preview=document.createElement('button');preview.className='icon-button small';preview.innerHTML=icon('play');preview.setAttribute('aria-label',`Play ${r.name}`);preview.onclick=()=>audio.preview(id,project).catch(errorMessage);const name=document.createElement('span');name.textContent=`${r.name} · ${r.duration.toFixed(1)}s`;const add=document.createElement('button');add.className='text-button';add.textContent='+ Add';add.onclick=()=>addCue(id);const remove=document.createElement('button');remove.className='icon-button small';remove.innerHTML=icon('trash');remove.setAttribute('aria-label',`Delete ${r.name}`);remove.onclick=()=>{
    openModal('Remove this recording?',`<p>“${escape(r.name)}” and its sound cues will be removed from every frame. Undo can restore them.</p><div class="modal-actions"><button id="keep-recording" class="button">Keep it</button><button id="delete-recording" class="button danger">Remove recording</button></div>`);$('keep-recording').onclick=openSounds;$('delete-recording').onclick=()=>{const recordings={...project.recordings};delete recordings[id];commit({...project,recordings,frames:project.frames.map(f=>({...f,cues:f.cues.filter(c=>c.sound!==id)}))});audio.clear();openSounds();};
  };item.append(preview,name,add,remove);root.append(item);}}
function openSounds(){
  openModal('Give your story a voice.',`<p>Sounds start on <strong>frame ${index+1}</strong>. Preview a sound, then add it to this moment.</p><div class="sound-grid">${SFX.map(sound=>`<div class="sound-card"><button class="sound-preview" data-preview="${sound}"><span>${soundGlyphs[sound]}</span><span>${soundNames[sound]}</span></button><button class="text-button" data-add-sound="${sound}">+ Add to frame</button></div>`).join('')}</div><span class="eyebrow">ON THIS FRAME</span><div class="sound-cues" id="sound-cues"></div><div class="record-box"><button id="record" class="record-button">${icon('mic')}<span>Record your own sound</span></button><p id="record-info">Up to 30 seconds. Your microphone starts only when you tap Record. Recordings stay on your device and in exported project files.</p></div><div id="recordings"></div><p class="export-note">Clips play until they finish or the animation stops. Video and WAV include sound; GIF does not.</p>`,'A POP. A BOING. YOUR OWN VOICE.');
  modalCleanup=()=>mic.stop(true);
  document.querySelectorAll('[data-preview]').forEach(button=>button.onclick=()=>audio.preview(button.dataset.preview,project).catch(errorMessage));document.querySelectorAll('[data-add-sound]').forEach(button=>button.onclick=()=>addCue(button.dataset.addSound));renderSoundCues();renderRecordings();
  const reset=()=>{const button=$('record');if(button){button.disabled=false;button.classList.remove('recording');button.innerHTML=icon('mic')+'<span>Record another sound</span>';}};
  $('record').onclick=async()=>{
    if(mic.recorder){$('record').disabled=true;mic.stop();return;}
    const button=$('record');button.disabled=true;button.innerHTML=icon('mic')+'<span>Opening microphone…</span>';
    try{audio.stop();await mic.start({onTick:seconds=>{if($('record-info'))$('record-info').textContent=`Recording… ${seconds.toFixed(1)} / 30 seconds. Tap Stop when you are done.`;},onStop:r=>{
      try{const total=Object.values(project.recordings).reduce((n,item)=>n+item.data.length,0)+r.data.length;if(total>LIMITS.audioBytes)throw new Error('Your sound collection is full. Remove an old recording first.');
        r.name=`My sound ${Object.keys(project.recordings).length+1}`;const {id,...record}=r;commit({...project,recordings:{...project.recordings,[id]:record}});addCue(id);renderRecordings();if($('record-info'))$('record-info').textContent='Sound saved on your device. You can add it to other frames, too.';
      }catch(error){errorMessage(error);}reset();
    },onError:error=>{reset();errorMessage(error);}});
      if(mic.recorder&&$('record')){button.disabled=false;button.classList.add('recording');button.innerHTML=icon('stop')+'<span>Stop recording</span>';}
    }catch(error){reset();errorMessage(error);if($('record-info'))$('record-info').textContent=error.message;}
  };
}
function openHelp(){openModal('Small steps. Big stories.',`<div class="help-steps"><div class="help-step"><span class="step-number">1</span><div><strong>Make a little drawing.</strong><p>Pick a brush and any color. Try pencil, crayon, watercolor, or glow. Layers keep your sketch and colors separate.</p></div></div><div class="help-step"><span class="step-number">2</span><div><strong>Give it a little nudge.</strong><p>Duplicate a frame, change a little something, and repeat. Pink onion skin shows the previous frame; green shows the next.</p></div></div><div class="help-step"><span class="step-number">3</span><div><strong>And… action!</strong><p>Press Play. Change the speed, hold a frame longer, and add sounds. Keep it saves your story as a project, GIF, video, or pictures.</p></div></div></div><p>Pinch with two fingers to zoom and move. On a computer, use the scroll wheel to zoom and hold Space to pan. Frame options move frames on touch screens. Fill works on the selected layer.</p><p class="keyboard-help"><kbd>B</kbd> draw · <kbd>E</kbd> erase · <kbd>F</kbd> fill · <kbd>S</kbd> shapes · <kbd>T</kbd> text · <kbd>I</kbd> pick color · <kbd>H</kbd> pan<br><kbd>←</kbd> <kbd>→</kbd> frames · <kbd>N</kbd> new frame · <kbd>D</kbd> duplicate · <kbd>Enter</kbd> play · <kbd>O</kbd> onion skin<br><kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Ctrl/⌘ Shift Z</kbd> redo · <kbd>[</kbd> <kbd>]</kbd> brush size · <kbd>0</kbd> fit view</p><p class="export-note">Saved work stays in this browser. Download .flipbook files for backups. Recordings may need the browser that created them; export a WAV for wider audio compatibility.</p>`,'WELCOME TO YOUR LITTLE STUDIO');}

// UI events are bound once; drawing itself stays outside DOM updates.
for(const color of PALETTE){const button=document.createElement('button');button.className='swatch';button.dataset.color=color;button.style.setProperty('--swatch',color);button.setAttribute('aria-label',`Use ${color}`);button.setAttribute('aria-pressed',color===studio.settings.color);button.onclick=()=>setColor(color);$('swatches').append(button);}
const brushGlyph={pen:'╱',pencil:'╱',marker:'▰',crayon:'▧',watercolor:'◕',airbrush:'◌',neon:'✧',pixel:'▦'},brushShort={pen:'Ink',pencil:'Pencil',marker:'Marker',crayon:'Crayon',watercolor:'Wash',airbrush:'Air',neon:'Glow',pixel:'Pixel'};
for(const [id,info]of Object.entries(BRUSHES)){if(id==='eraser')continue;const button=document.createElement('button');button.className='brush-choice';button.dataset.brush=id;button.setAttribute('aria-label',info.name);button.setAttribute('aria-pressed',id===brush);button.title=info.hint;button.innerHTML=`<span aria-hidden="true">${brushGlyph[id]}</span><span>${brushShort[id]}</span>`;button.onclick=()=>{brush=id;selectTool('draw');};$('brush-grid').append(button);}
document.querySelectorAll('.tool[data-tool]').forEach(button=>button.onclick=()=>selectTool(button.dataset.tool));
$('size').oninput=$('size').onchange=e=>syncSizeControl(e.target.value);$('opacity').oninput=$('opacity').onchange=e=>{studio.settings.opacity=Number(e.target.value)/100;$('opacity-value').textContent=`${e.target.value}%`;drawBrushPreview();};$('stabilize').onchange=e=>studio.settings.stabilize=e.target.checked;$('shape-type').onchange=e=>studio.settings.shape=e.target.value;$('shape-fill').onchange=e=>studio.settings.fill=e.target.checked;$('custom-color').oninput=e=>setColor(e.target.value);
$('project-title').onchange=e=>{commit({...project,title:e.target.value.trim()||'My little flipbook'});};$('paper-color').onchange=e=>commit({...project,background:e.target.value});
$('settings-toggle').onclick=()=>{const open=$('settings').classList.toggle('open');$('settings-toggle').setAttribute('aria-expanded',open);};$('close-settings').onclick=()=>{$('settings').classList.remove('open');$('settings-toggle').setAttribute('aria-expanded','false');};
$('undo').onclick=()=>restoreHistory();$('redo').onclick=()=>restoreHistory(true);$('zoom-in').onclick=()=>studio.setZoom(studio.zoom*1.25);$('zoom-out').onclick=()=>studio.setZoom(studio.zoom/1.25);$('zoom-reset').onclick=()=>studio.resetView();
$('onion').onclick=()=>{studio.onion=!studio.onion;$('onion').setAttribute('aria-pressed',studio.onion);studio.requestDraw();};$('mute').onclick=()=>{audio.enabled=!audio.enabled;$('mute').setAttribute('aria-pressed',!audio.enabled);$('mute').setAttribute('aria-label',audio.enabled?'Mute animation sounds':'Unmute animation sounds');$('mute').innerHTML=icon(audio.enabled?'sound':'muted');if(!audio.enabled)audio.stop();else if(playing)audio.play(project,{start:timeline(project)[index].start}).catch(errorMessage);};
$('play').onclick=()=>startPlayback();$('previous').onclick=()=>selectFrame(Math.max(0,index-1));$('next').onclick=()=>selectFrame(Math.min(project.frames.length-1,index+1));$('fps').onchange=e=>commit({...project,fps:Number(e.target.value)});$('loop').onclick=()=>commit({...project,loop:!project.loop});
function newFrame(duplicate=false){try{const next=insertFrame(project,index,duplicate);index++;commit(next);selectFrame(index);}catch(error){errorMessage(error);}}
$('add-frame').onclick=()=>newFrame();$('duplicate-frame').onclick=()=>newFrame(true);$('delete-frame').onclick=confirmDeleteFrame;$('frame-options').onclick=openFrameOptions;$('add-layer').onclick=()=>{try{const next=addLayer(project);layer=next.layers[0].id;commit(next);}catch(error){errorMessage(error);}};$('layer-options').onclick=openLayerOptions;
$('new-project').onclick=openNew;$('shelf').onclick=openShelf;$('export').onclick=openExport;$('sounds').onclick=openSounds;$('help').onclick=openHelp;$('toolbox-help').onclick=openHelp;$('close-modal').onclick=closeModal;$('modal').addEventListener('cancel',()=>{if(busy)exportController?.abort();modalCleanup?.();modalCleanup=null;});$('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else toast('For more room, add Flipbook to your Home Screen from your browser menu.');}catch{toast('Full screen is not available in this browser.');}};
$('project-file').onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file)return;try{if(file.size>LIMITS.fileBytes)throw new Error('Choose a Flipbook file smaller than 32 MB.');const parsed=parseProject(await file.text());parsed.id=uid();await replaceProject(parsed);toast('Your flipbook is open. Let’s make it move.');}catch(error){errorMessage(error);}};
$('import-image').onclick=()=>$('image-file').click();$('image-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;const projectId=project.id,frameId=project.frames[index].id,layerId=layer;
  try{if(file.size>8*1024*1024)throw new Error('Choose a picture smaller than 8 MB.');if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG, or WebP picture.');const url=URL.createObjectURL(file);let image;try{image=new Image();image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}if(image.width*image.height>24e6)throw new Error('Choose a picture smaller than 24 megapixels.');
    if(project.id!==projectId||project.frames[index].id!==frameId||layer!==layerId)throw new Error('The frame changed. Please add that picture again.');const scale=Math.min(1,project.width/image.width,project.height/image.height),w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale)),c=canvas(w,h);context(c).drawImage(image,0,0,w,h);const src=c.toDataURL('image/png');let total=src.length;for(const f of project.frames)for(const ops of Object.values(f.cells))for(const op of ops)total+=op.src?.length??0;if(total>LIMITS.imageBytes)throw new Error('This flipbook has too many pictures. Start a new one for this image.');renderer.images.set(src,c);commit(appendOperation(project,index,layer,{kind:'image',src,at:[(project.width-w)/2,(project.height-h)/2],width:w,height:h}));toast('Picture added to this layer. Layer options can move it.');
  }catch(error){errorMessage(error);}
};
document.addEventListener('keydown',e=>{
  if(e.target.closest?.('input,textarea,select')||$('modal').open||busy)return;const key=e.key.toLowerCase();
  if(e.target.closest?.('button,a')&&(key==='enter'||key===' '))return;
  if(e.repeat&&['n','d','enter'].includes(key))return;
  if((e.ctrlKey||e.metaKey)&&key==='z'){e.preventDefault();restoreHistory(e.shiftKey);return;}
  if(e.ctrlKey||e.metaKey){if(key==='s'){e.preventDefault();try{projectDownload();}catch(error){errorMessage(error);}}return;}
  if(key===' '){e.preventDefault();studio.space=true;return;}
  const tool={b:'draw',e:'eraser',f:'fill',s:'shape',t:'text',i:'picker',h:'hand'}[key];if(tool){e.preventDefault();selectTool(tool);return;}
  if(key==='enter'){e.preventDefault();startPlayback();}if(key==='arrowleft'){e.preventDefault();selectFrame(Math.max(0,index-1));}if(key==='arrowright'){e.preventDefault();selectFrame(Math.min(project.frames.length-1,index+1));}if(key==='n')newFrame();if(key==='d')newFrame(true);if(key==='o')$('onion').click();if(key==='0')studio.resetView();if(key==='?')openHelp();if(key==='['||key===']')syncSizeControl(studio.settings.size+(key===']'?2:-2));if(key==='escape')stopPlayback();
});
document.addEventListener('keyup',e=>{if(e.code==='Space')studio.space=false;});window.addEventListener('blur',()=>{studio.space=false;studio.cancelGesture();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopPlayback();mic.stop(true);if($('record')){$('record').disabled=false;$('record').classList.remove('recording');$('record').innerHTML=icon('mic')+'<span>Record your own sound</span>';$('record-info').textContent='The microphone stopped when you left Flipbook. Tap Record to start a new sound.';}studio.cancelGesture();saveNow().catch(()=>{});}});window.addEventListener('pagehide',()=>{mic.stop(true);audio.stop();saveNow().catch(()=>{});});window.addEventListener('beforeunload',e=>{if(savedRevision!==revision&&backupRevision!==revision){e.preventDefault();e.returnValue='';}});

async function boot(){
  try{await document.fonts?.ready;}
  catch(error){toast('Device saves could not be opened. Use Keep it to download a backup.');}
  ready=true;render();selectTool('draw');studio.resetView();requestAnimationFrame(()=>studio.resetView());scheduleSave();
  if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
boot();
