const DB_NAME='flipbook-studio-v1';let connection;
async function database(){
  if(connection)return connection;
  if(!globalThis.indexedDB)throw new Error('Device saving is unavailable. Download a Flipbook file to keep your work.');
  connection=await new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore('projects',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other Flipbook tabs, then try saving again.'));});
  connection.onversionchange=()=>{connection.close();connection=null;};return connection;
}
async function transaction(mode,run){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('projects',mode),request=run(tx.objectStore('projects'));let result;request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=tx.onerror=()=>reject(tx.error??new Error('Your device could not save this flipbook. Download a project backup.'));});}
export async function saveProject(project,thumbnail){return transaction('readwrite',store=>store.put({id:project.id,project,thumbnail,updated:Date.now()}));}
export async function loadProject(id){return transaction('readonly',store=>store.get(id));}
export async function listProjects(){
  const db=await database();return new Promise((resolve,reject)=>{const records=[],tx=db.transaction('projects','readonly'),request=tx.objectStore('projects').openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const r=cursor.value;records.push({id:r.id,title:r.project.title,frameCount:r.project.frames.length,thumbnail:r.thumbnail,updated:r.updated});cursor.continue();};tx.oncomplete=()=>resolve(records.sort((a,b)=>b.updated-a.updated));tx.onerror=()=>reject(tx.error);});
}
export async function deleteProject(id){return transaction('readwrite',store=>store.delete(id));}
export function closeStorage(){connection?.close();connection=null;}
