// Simulates a BRAND-NEW Firebase (empty) with the real api/orders.js + api/_verify-price.js code.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(process.argv[2] || process.cwd());
process.chdir(ROOT);
process.env.FIREBASE_DATABASE_URL = 'https://fake-rtdb.firebaseio.com';
process.env.FIREBASE_AUTH_SECRET = 'x';
process.env.ADMIN_JWT_SECRET = 'y'.repeat(32);
process.env.ADMIN_USERNAME = 'a'; process.env.ADMIN_PASSWORD = 'b';

// ---- minimal in-memory Firebase REST (GET/PUT/PATCH/DELETE + ETag/if-match) ----
let db = null; let etagN = 1; const etags = new Map();
const segs = p => p.split('/').filter(Boolean);
function getAt(p){ let n=db; for(const s of segs(p)){ if(n==null||typeof n!=='object') return null; n=n[s]; if(n===undefined) return null;} return n; }
function setAt(p,v){ const s=segs(p); if(!s.length){db=v;return;} if(db==null||typeof db!=='object') db={}; let n=db; for(let i=0;i<s.length-1;i++){ if(n[s[i]]==null||typeof n[s[i]]!=='object') n[s[i]]={}; n=n[s[i]]; } if(v===null) delete n[s[s.length-1]]; else n[s[s.length-1]]=v; }
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts={}) => {
  const u = new URL(url);
  if (!u.hostname.includes('fake-rtdb')) return realFetch(url, opts);
  const p = decodeURIComponent(u.pathname).replace(/\.json$/,'');
  const method=(opts.method||'GET').toUpperCase(); const h=Object.fromEntries(Object.entries(opts.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  const key = p;
  if (method==='GET'){ const v=getAt(p); const hd=new Headers(); if(h['x-firebase-etag']==='true'){ if(!etags.has(key)) etags.set(key,'e'+(etagN++)); hd.set('etag',etags.get(key)); } return new Response(JSON.stringify(v),{status:200,headers:hd}); }
  if (h['if-match'] && etags.get(key)!==h['if-match']) return new Response('{"error":"precondition"}',{status:412});
  if (method==='PUT'){ setAt(p, JSON.parse(opts.body)); etags.set(key,'e'+(etagN++)); return new Response(opts.body,{status:200}); }
  if (method==='PATCH'){ const cur=getAt(p)||{}; setAt(p,{...cur,...JSON.parse(opts.body)}); return new Response(opts.body,{status:200}); }
  if (method==='DELETE'){ setAt(p,null); return new Response('null',{status:200}); }
  return new Response('null',{status:200});
};


const { default: handler } = await import(pathToFileURL(path.join(ROOT,'api/orders.js')).href);
const fs = await import('node:fs');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT,'products.json'),'utf8'));
const bike = catalog.find(p=>Number(p.price)>0 && Number(p.stock)===2) || catalog.find(p=>Number(p.price)>0);
const fileStock = Number(bike.stock);
console.log(`Fresh-Firebase test | local catalog=${catalog.length} | bike=${bike.id} price=${bike.price} stock(in products.json)=${fileStock}`);

let ip = 0;
function call(){ ip++; return new Promise(async (resolve)=>{
  const req={method:'POST',headers:{'x-vercel-forwarded-for':'9.9.9.'+ip,'content-type':'application/json'},query:{},body:{customer:'Test User',phone:'01012345678',gov:'\u0627\u0644\u0642\u0627\u0647\u0631\u0629',city:'Nasr',address:'street 1 test address',payment:'cod',items:[{id:bike.id,quantity:1}],total:bike.price+150,shippingFee:150}};
  const res={setHeader(){},status(c){this.code=c;return this},json(b){resolve({code:this.code,body:b})},end(){resolve({code:this.code})}};
  try{ await handler(req,res);}catch(e){resolve({code:'THROW',body:e.message});} }); }

const results = [];
for (let i=1;i<=fileStock+1;i++){ const r = await call(); results.push(r.code); console.log(`  order #${i}: HTTP ${r.code}` + (r.code===201?'':'  '+JSON.stringify(r.body).slice(0,110))); }
const cat = getAt('/products');
const arr = Array.isArray(cat)?cat:(cat?Object.values(cat):[]);
const validEntries = arr.filter(p=>p && p.id && Number(p.price)>0).length;
console.log(`  Firebase /products after test: ${arr.length} entries, ${validEntries} valid (have id+price)`);

const expected = [...Array(fileStock).fill(201), 409];
const okSeq = JSON.stringify(results)===JSON.stringify(expected);
const okCat = validEntries >= catalog.length*0.9;
console.log('\nCHECK 1 - first '+fileStock+' orders succeed, next one rejected 409 (stock respected):', okSeq?'PASS':'FAIL', ' got', JSON.stringify(results), 'expected', JSON.stringify(expected));
console.log('CHECK 2 - Firebase catalog is a real catalog, not stub nodes:', okCat?'PASS':'FAIL');
process.exit(okSeq && okCat ? 0 : 1);
