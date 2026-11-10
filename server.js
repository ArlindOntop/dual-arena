// Duel Arena game server: static files + a tiny zero-dependency WebSocket relay.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||3000,PUB=path.join(__dirname,'public');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const VERSION=process.env.RENDER_GIT_COMMIT||process.env.GIT_COMMIT||String(Date.now());
const rooms=new Map(),clients=new Set();

// ---- mini accounts: a random code is the key; progress is stored as small JSON ----
const DATA=process.env.DATA_DIR||path.join(__dirname,'data'),SAVEF=path.join(DATA,'saves.json');
let saves={};try{saves=JSON.parse(fs.readFileSync(SAVEF,'utf8'));}catch{}
const persist=()=>{try{fs.mkdirSync(DATA,{recursive:true});fs.writeFileSync(SAVEF+'.tmp',JSON.stringify(saves));fs.renameSync(SAVEF+'.tmp',SAVEF);}catch(e){console.log('save failed',e.message);}};
const CODE=/^[A-HJ-NP-Z2-9]{10}$/,ID=/^[a-z0-9_]{1,24}$/,rl=new Map();
const limited=ip=>{const n=Date.now(),a=(rl.get(ip)||[]).filter(t=>n-t<60000);a.push(n);rl.set(ip,a);return a.length>40;};
const ids=a=>Array.isArray(a)?[...new Set(a.filter(x=>typeof x==='string'&&ID.test(x)))].slice(0,40):[];
function clean(d){if(!d||typeof d!=='object')return null;const n=(v,max)=>Number.isFinite(v)?Math.max(0,Math.min(max,Math.floor(v))):0,sel=d.sel&&typeof d.sel==='object'?d.sel:{};
 return{v:n(d.v,9),coins:n(d.coins,1e7),ch:ids(d.ch),cw:ids(d.cw),ar:ids(d.ar),r:n(d.r,5000),u:d.u?1:0,sel:{wp:ID.test(sel.wp)?sel.wp:'',cw:ID.test(sel.cw)?sel.cw:'',ar:ID.test(sel.ar)?sel.ar:''}};}
function api(req,res,u,q){
 const out=(c,o)=>{res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
 const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
 if(limited(ip))return out(429,{error:'slow down'});
 if(u==='/api/load'&&req.method==='GET'){const c=(q.get('code')||'').toUpperCase();if(!CODE.test(c))return out(400,{error:'bad code'});return saves[c]?out(200,{data:saves[c]}):out(404,{error:'not found'});}
 if(u==='/api/save'&&req.method==='POST'){let b='';req.on('data',d=>{b+=d;if(b.length>4096)req.destroy();});req.on('end',()=>{let j;try{j=JSON.parse(b);}catch{return out(400,{error:'bad json'});}
  const c=String(j.code||'').toUpperCase(),d=clean(j.data);if(!CODE.test(c)||!d)return out(400,{error:'bad data'});
  if(!saves[c]&&Object.keys(saves).length>=20000)return out(507,{error:'full'});saves[c]=d;persist();out(200,{ok:1});});return;}
 out(404,{error:'nope'});}

const srv=http.createServer((req,res)=>{
 let u=decodeURIComponent(req.url.split('?')[0]);
 if(u==='/healthz'){res.end('ok');return;}
 if(u==='/version'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({v:VERSION}));return;}
 if(u.startsWith('/api/'))return api(req,res,u,new URL(req.url,'http://x').searchParams);
 if(u==='/')u='/index.html';
 const f=path.join(PUB,u);
 if(f!==PUB&&!f.startsWith(PUB+path.sep)){res.writeHead(403);return res.end();}
 fs.readFile(f,(e,d)=>{
  if(e){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(d);});
});

const frame=s=>{const p=Buffer.from(s);const h=p.length<126?Buffer.from([0x81,p.length]):Buffer.from([0x81,126,p.length>>8,p.length&255]);return Buffer.concat([h,p]);};
const tx=(c,o)=>{if(!c.sock.destroyed)c.sock.write(frame(JSON.stringify(o)));};
const bcast=(r,except,o)=>{const f=frame(JSON.stringify(o));for(const[id,e]of r)if(id!==except&&!e.c.sock.destroyed)e.c.sock.write(f);};

function drop(c,name){
 const r=rooms.get(name);if(!r)return;r.delete(c.id);c.rooms.delete(name);
 if(!r.size)rooms.delete(name);else bcast(r,null,{t:'left',room:name,id:c.id});}

function handle(c,s){
 if(++c.n>80)return;
 let m;try{m=JSON.parse(s);}catch{return;}
 if(!m||typeof m!=='object')return;
 const name=String(m.room||'');if(!/^[a-z0-9]{1,40}$/.test(name))return;
 if(m.t==='join'){
  if(c.rooms.has(name)||c.rooms.size>=3)return;
  let r=rooms.get(name);
  if(r&&r.size>=(name==='lobby'?300:name[0]==='g'?4:2)){tx(c,{t:'err',room:name,code:'full'});return;}
  if(!r)rooms.set(name,r=new Map());
  r.set(c.id,{c,p:{}});c.rooms.add(name);
  tx(c,{t:'state',room:name,you:c.id,peers:[...r].map(([id,e])=>({id,p:e.p}))});
  bcast(r,c.id,{t:'upd',room:name,id:c.id,p:{}});
 }else if(m.t==='pres'){
  const r=rooms.get(name),e=r&&r.get(c.id);
  if(!e||!m.p||typeof m.p!=='object'||JSON.stringify(m.p).length>4096)return;
  e.p=m.p;bcast(r,c.id,{t:'upd',room:name,id:c.id,p:m.p});
 }else if(m.t==='leave')drop(c,name);}

function parse(c){
 for(;;){
  const b=c.buf;if(b.length<2)return;
  const fin=b[0]&128,op=b[0]&15;let len=b[1]&127,off=2;
  if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4;}
  else if(len===127){c.sock.destroy();return;}
  if(!(b[1]&128)||!fin||len>8192){c.sock.destroy();return;}
  if(b.length<off+4+len)return;
  const mask=b.subarray(off,off+4),d=Buffer.from(b.subarray(off+4,off+4+len));
  for(let i=0;i<len;i++)d[i]^=mask[i&3];
  c.buf=b.subarray(off+4+len);
  if(op===8){c.sock.end();return;}
  if(op===9)c.sock.write(Buffer.from([0x8A,0]));
  else if(op===1)handle(c,d.toString());}}

srv.on('upgrade',(req,sock)=>{
 const key=req.headers['sec-websocket-key'];
 if(req.url.split('?')[0]!=='/ws'||!key||clients.size>=1500){sock.destroy();return;}
 const acc=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+acc+'\r\n\r\n');
 const c={sock,id:crypto.randomBytes(6).toString('hex'),rooms:new Set(),buf:Buffer.alloc(0),n:0};
 clients.add(c);sock.setNoDelay(true);
 const bye=()=>{if(!clients.delete(c))return;for(const n of[...c.rooms])drop(c,n);};
 sock.on('data',d=>{c.buf=Buffer.concat([c.buf,d]);parse(c);});
 sock.on('close',bye);sock.on('error',bye);});

setInterval(()=>{for(const c of clients)c.n=0;},1000);
setInterval(()=>{for(const c of clients)if(!c.sock.destroyed)c.sock.write(Buffer.from([0x89,0]));},25000);
srv.listen(PORT,()=>console.log('Duel Arena running on port '+PORT));
