import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for(const file of await readdir('dist'))if(file.endsWith('.js')){const result=spawnSync(process.execPath,['--check',`dist/${file}`],{stdio:'inherit'});if(result.status)process.exit(result.status);}
const html=await readFile('dist/index.html','utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(ids.length!==new Set(ids).size)throw new Error('Duplicate HTML IDs');
console.log('JavaScript syntax and HTML IDs checked.');
