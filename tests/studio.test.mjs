import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { Studio } from '../dist/studio.js';
import { Renderer } from '../dist/drawing.js';
import { newProject } from '../dist/model.js';
globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.ResizeObserver=class{observe(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
function setup(){const viewport={addEventListener(){},setPointerCapture(){},releasePointerCapture(){},hasPointerCapture(){return true;},getBoundingClientRect:()=>({left:0,top:0,width:1000,height:700})};const paper=createCanvas(960,600);paper.style={};paper.getBoundingClientRect=()=>({left:20,top:50,width:960,height:600});const commits=[],messages=[],studio=new Studio(viewport,paper,new Renderer(),{onCommit:op=>commits.push(op),onMessage:message=>messages.push(message)});const p=newProject();studio.setProject(p,0,p.layers[0].id);return{studio,commits,messages,p};}
const event=(id,x,y,extras={})=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',pressure:.8,button:0,preventDefault(){},...extras});
test('mouse, touch, and pressure input commit a stroke only on release',()=>{
  const{studio,commits}=setup();studio.down(event(1,100,100));studio.move(event(1,150,150));assert.equal(commits.length,0);studio.up(event(1,180,150));assert.equal(commits.length,1);assert(commits[0].points.length>=3);assert.equal(studio.drawing,null);assert.equal(studio.pointers.size,0);
});
test('a second finger cancels an unfinished stroke, then pinches and pans without stray ink',()=>{
  const{studio,commits}=setup();studio.down(event(1,100,100));studio.move(event(1,120,120));studio.down(event(2,200,200));assert.equal(studio.drawing,null);studio.move(event(2,300,300));assert(studio.zoom>1);studio.up(event(2,300,300));studio.move(event(1,400,400));studio.up(event(1,400,400));assert.equal(commits.length,0);assert.equal(studio.gesture,null);
  studio.down(event(3,100,100));studio.up(event(3,100,100));assert.equal(commits.length,1);
});
test('pointer cancellation, lost capture, and pan do not create drawing operations',()=>{
  const{studio,commits}=setup();studio.down(event(1,100,100));studio.cancelGesture();studio.up(event(1,180,180));assert.equal(commits.length,0);studio.settings.tool='hand';studio.down(event(2,100,100));studio.move(event(2,200,130));studio.up(event(2,200,130));assert.equal(studio.pan.x,100);assert.equal(commits.length,0);
});
test('zoom is bounded, recenter restores the view, and hidden layers reject ink',()=>{
  const{studio,commits,messages,p}=setup();studio.setZoom(100);assert.equal(studio.zoom,8);studio.setZoom(.001);assert.equal(studio.zoom,.25);studio.resetView();assert.equal(studio.zoom,1);assert.deepEqual(studio.pan,{x:0,y:0});p.layers[0].visible=false;studio.down(event(1,100,100));studio.up(event(1,100,100));assert.equal(commits.length,0);assert.match(messages[0],/Show this layer/);
});
test('shape previews replace themselves and movement is constrained to valid file coordinates',()=>{
  const{studio,commits}=setup();studio.settings.tool='shape';studio.down(event(1,100,100));studio.move(event(1,300,300));studio.up(event(1,300,300));assert.equal(commits[0].kind,'shape');assert.deepEqual(commits[0].from,[80,50]);assert.deepEqual(commits[0].to,[280,250]);const point=studio.point(event(2,1e9,-1e9));assert(point[0]<=8192&&point[1]>=-8192);
});
