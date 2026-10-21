import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import 'fake-indexeddb/auto';
import { parseProject } from '../dist/model.js';
import { listProjects, loadProject, closeStorage } from '../dist/storage.js';

const {window,document}=parseHTML(await readFile(new URL('../dist/index.html',import.meta.url),'utf8'));
globalThis.window=window;globalThis.document=document;globalThis.location={protocol:'http:'};globalThis.HTMLCanvasElement=window.HTMLCanvasElement;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});
Object.defineProperty(document,'fonts',{value:{ready:Promise.resolve()}});Object.defineProperty(document,'hidden',{value:false,writable:true});
GlobalFonts.registerFromPath(new URL('../dist/fonts/dm-sans.woff2',import.meta.url).pathname,'DM Sans');
const nativeCanvases=new WeakMap(),contexts=new WeakMap();
function native(c){if(!nativeCanvases.has(c))nativeCanvases.set(c,createCanvas(Number(c.getAttribute('width')??300),Number(c.getAttribute('height')??150)));return nativeCanvases.get(c);}
for(const property of ['width','height'])Object.defineProperty(window.HTMLCanvasElement.prototype,property,{configurable:true,get(){return Number(this.getAttribute(property)??(property==='width'?300:150));},set(value){this.setAttribute(property,String(value));if(nativeCanvases.has(this))native(this)[property]=Number(value);}});
window.HTMLCanvasElement.prototype.getContext=function(){if(!contexts.has(this)){const ctx=native(this).getContext('2d');contexts.set(this,new Proxy(ctx,{get(target,key){if(key==='drawImage')return(source,...args)=>target.drawImage(source instanceof window.HTMLCanvasElement?native(source):source,...args);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;},set(target,key,value){target[key]=value;return true;}}));}return contexts.get(this);};
window.HTMLCanvasElement.prototype.toDataURL=function(){return native(this).toDataURL('image/png');};window.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob([native(this).toBuffer('image/png')],{type:'image/png'}));};
window.HTMLElement.prototype.scrollIntoView=function(){};
window.HTMLElement.prototype.getBoundingClientRect=function(){if(this.id==='paper'){const width=parseFloat(this.style.width)||960,height=parseFloat(this.style.height)||600;return{left:80+(1000-width)/2,top:150+(520-height)/2,width,height,right:80+(1000+width)/2,bottom:150+(520+height)/2};}return{left:80,top:150,width:1000,height:520,right:1080,bottom:670};};
window.HTMLElement.prototype.setPointerCapture=function(id){this.capture=id;};window.HTMLElement.prototype.hasPointerCapture=function(id){return this.capture===id;};window.HTMLElement.prototype.releasePointerCapture=function(){this.capture=null;};
const modal=document.getElementById('modal');modal.showModal=function(){this.open=true;};modal.close=function(){this.open=false;};
for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{configurable:true,get(){return this._value??this.querySelector('option[selected]')?.value??this.querySelector('option')?.value;},set(value){this._value=String(value);}});
const raf=new Map();let nextRaf=0;globalThis.requestAnimationFrame=callback=>{raf.set(++nextRaf,callback);return nextRaf;};globalThis.cancelAnimationFrame=id=>raf.delete(id);globalThis.ResizeObserver=class{observe(){}};
const downloads=[];URL.createObjectURL=blob=>{downloads.push(blob);return'blob:flipbook-test';};URL.revokeObjectURL=()=>{};
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(callback,ms,...args)=>{const handle=nativeTimeout(callback,ms,...args);if(ms>=4000)handle.unref();return handle;};
const $=id=>document.getElementById(id),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await delay(10);}throw new Error('UI condition did not become true.');}
function flush(){for(let loop=0;loop<40&&raf.size;loop++){const pending=[...raf];raf.clear();for(const[,callback]of pending)callback(performance.now());}}
function pointer(type,x,y,id=1){const event=new window.Event(type,{bubbles:true});Object.assign(event,{pointerId:id,clientX:x,clientY:y,pointerType:'mouse',pressure:.8,button:0});$('viewport').dispatchEvent(event);}
function center(){const r=$('paper').getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2];}

test('complete DOM flow: starter, new drawing, undo, animation, layers, sounds, export, and reopen',async t=>{
  await import('../dist/app.js');await waitFor(()=>$('filmstrip').children.length===12);flush();
  await t.test('starter is editable, fully rendered, and has no fake controls',()=>{assert.equal($('project-title').value,'A little happy bounce');assert.equal(document.querySelectorAll('.brush-choice').length,8);assert.equal(document.querySelectorAll('.swatch').length,14);assert.equal($('layers').children.length,2);assert.equal($('frame-count').textContent,'12 frames');assert($('paper').getContext('2d').getImageData(480,337,1,1).data[0]>200);});
  await t.test('blank project, drawing, undo and redo affect real canvas pixels',async()=>{
    $('new-project').click();assert(modal.open);document.querySelector('[data-new="720,720"]').click();await waitFor(()=>!modal.open&&$('filmstrip').children.length===1);flush();assert.equal($('paper').width,720);const[x,y]=center();pointer('pointerdown',x-30,y);pointer('pointermove',x,y);pointer('pointerup',x+30,y);flush();assert($('paper').getContext('2d').getImageData(360,360,1,1).data[0]<100);$('undo').click();flush();assert($('paper').getContext('2d').getImageData(360,360,1,1).data[0]>240);$('redo').click();flush();assert($('paper').getContext('2d').getImageData(360,360,1,1).data[0]<100);
  });
  await t.test('frame duplication, holds, reorder controls, and onion toggle work',()=>{
    $('duplicate-frame').click();flush();assert.equal($('filmstrip').children.length,2);assert.match($('frame-position').textContent,/02 OF 02/);$('frame-options').click();$('frame-hold').value='4';$('apply-frame').click();assert.match($('duration').textContent,/0.6/);$('frame-options').click();$('move-earlier').click();$('apply-frame').click();flush();assert.match($('frame-position').textContent,/01 OF 02/);$('onion').click();assert.equal($('onion').getAttribute('aria-pressed'),'false');
  });
  await t.test('layer options and text create editable art without interpreting markup',()=>{
    $('add-layer').click();assert.equal($('layers').children.length,3);$('layer-options').click();$('layer-name').value='Words <script>'; $('apply-layer').click();assert($('layers').textContent.includes('Words <script>'));assert.equal($('layers').querySelectorAll('script').length,0);document.querySelector('[data-tool="text"]').click();const[x,y]=center();pointer('pointerdown',x,y-50);pointer('pointerup',x,y-50);assert(modal.open);$('text-content').value='Hello, little world!';$('place-text').click();flush();assert(!modal.open);
  });
  await t.test('sound cues can be added and removed without a microphone',()=>{
    $('sounds').click();document.querySelector('[data-add-sound="pop"]').click();assert($('sound-cues').textContent.includes('Pop'));$('sound-cues').querySelector('[aria-label="Remove sound from frame"]').click();assert($('sound-cues').textContent.includes('No sounds'));document.querySelector('[data-add-sound="sparkle"]').click();$('close-modal').click();
  });
  await t.test('editable export preserves all work and reopening validates and imports it',async()=>{
    $('export').click();document.querySelector('[data-export="project"]').click();const blob=downloads.at(-1),text=await blob.text(),p=parseProject(text);assert.equal(p.frames.length,2);assert.equal(p.frames[0].hold,4);assert.equal(p.layers.length,3);assert.equal(p.frames[0].cues[0].sound,'sparkle');assert(Object.values(p.frames[0].cells).some(ops=>ops.some(op=>op.kind==='text'&&op.text==='Hello, little world!')));$('close-modal').click();
    Object.defineProperty($('project-file'),'files',{configurable:true,value:[{size:blob.size,text:()=>Promise.resolve(text)}]});await $('project-file').onchange({target:$('project-file')});flush();assert.equal($('filmstrip').children.length,2);assert.equal($('project-title').value,p.title);
  });
  await t.test('device save and collection contain independently reopenable projects',async()=>{
    await delay(900);const records=await listProjects();assert(records.length>=3);const latest=await loadProject(records[0].id);assert.doesNotThrow(()=>parseProject(JSON.stringify(latest.project)));$('shelf').click();await waitFor(()=>$('shelf-items')?.children.length>=3);assert($('shelf-items').textContent.includes('My little flipbook'));$('close-modal').click();
  });
  document.hidden=true;document.dispatchEvent(new window.Event('visibilitychange'));flush();await delay(20);closeStorage();
});
