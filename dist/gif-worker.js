import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.js';
let gif;
self.onmessage=e=>{try{
  if(e.data.type==='start'){gif=GIFEncoder();self.postMessage({ready:true});}
  if(e.data.type==='frame'){const {pixels,width,height,delay,repeat}=e.data,palette=quantize(pixels,256),indexed=applyPalette(pixels,palette);gif.writeFrame(indexed,width,height,{palette,delay,repeat});self.postMessage({ready:true});}
  if(e.data.type==='finish'){gif.finish();const bytes=gif.bytes();self.postMessage({done:true,bytes},[bytes.buffer]);gif=null;}
}catch(error){self.postMessage({error:error.message});}};
