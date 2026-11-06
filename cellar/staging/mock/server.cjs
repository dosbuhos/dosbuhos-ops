const http=require('http'),fs=require('fs'),path=require('path');
const APP=path.join(__dirname,'../../public');
const BD=eval(fs.readFileSync(path.join(__dirname,'bdata.js'),'utf8').replace(/^const BDATA=/,'(').replace(/;\s*$/,'')+')');
const lots={},db={barrels:{},lots:{},barrel_log:{},barrel_pos:{},barrel_lists:{}};
const grp=w=>/orange|naranja/i.test(w)?'orange':/ros/i.test(w)?'rose':/SB|Chenin|Semill|Moscato|Chard|Sauv.*Blanc/i.test(w)?'white':'red';
for(const [code,b] of Object.entries(BD)){let lot='';if(b.wine){lot='l-'+b.wine.toLowerCase().replace(/[^a-z0-9]+/g,'-');db.lots[lot]={name:b.wine,group:grp(b.wine),vintage:+(b.wine.match(/20\d\d/)||[0])[0]||(+(b.wine.match(/\b(2\d)\b/)||[0,0])[1]?2000+ +b.wine.match(/\b(2\d)\b/)[1]:null)}}
  db.barrels[code]={code,cooperage:b.coop,wood:b.wood,year:b.year,use:b.use,fill:b.fill,size:b.size,lot:b.fill==='empty'?'':lot,wines:b.wines,history:b.so2,status:b.wine||b.fill==='empty'?'occupied2026':'confirm'};
  (b.logs||[]).forEach((l,i)=>{const [d,p]=l.split('|');db.barrel_log['b'+code+'-h'+d+p+i]={code,at:d+'T12:00:00.000Z',by:'Hoja',kind:'mant',proto:p,text:'(hoja de papel)',src:'hoja'}})}
const MAP=JSON.parse(fs.readFileSync(path.join(__dirname,'layout-pos.json')));
// migration: plan numbers → loc (same rule as the real one)
const refK=(id,code)=>/A\d-\d+$/.test(id)?id:code;
for(const [id,code,n] of MAP){if(!n)continue;const k=String(+n);if(db.barrels[k])db.barrels[k].loc=refK(id,code);}
const J=(res,o,s=200)=>{res.writeHead(s,{'content-type':'application/json'});res.end(JSON.stringify(o))};
http.createServer((req,res)=>{const u=new URL(req.url,'http://x');let b='';req.on('data',c=>b+=c);req.on('end',()=>{
  const p=u.pathname;
  if(p==='/api/me')return J(res,{canWrite:true,initials:process.env.ROLE==='crew'?'P/J':'EM',role:process.env.ROLE||'admin'});
  if(p==='/api/xl/barrel-so2')return J(res,{barrels:{'10':{so2:{d:'2026-11-02',v:'12.4',tab:'L05'},add:{d:'2026-11-03',g:'6',tab:'L05'}}}});
  if(p==='/api/xl/barrel')return J(res,{rows:[{tab:'L15 CF ROSE',date:'2026-11-06',ubi:'BBL 44, 48',note:'VIERNES 6/11 TRASEGAR…',asig:'P/J'}]});
  const m=p.match(/^\/api\/db\/([^/]+)(?:\/(.+))?$/);if(m){const c=m[1],id=m[2]&&decodeURIComponent(m[2]);db[c]=db[c]||{};
    if(req.method==='GET')return J(res,{rows:Object.entries(db[c]).map(([id,data])=>({id,data}))});
    if(req.method==='DELETE'){delete db[c][id];return J(res,{ok:true})}
    const body=JSON.parse(b||'{}');if(req.method==='PUT')db[c][id]=body;else{if(!db[c][id])return J(res,{code:'not_found'},404);Object.assign(db[c][id],body)}
    fs.appendFileSync(path.join(__dirname,'writes.log'),req.method+' '+c+'/'+id+' '+JSON.stringify(body)+'\n');return J(res,{ok:true,id})}
  const f=path.join(APP,p==='/'?'barricas.html':p);if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.writeHead(200,{'content-type':f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':f.endsWith('.json')?'application/json':'text/plain'});return res.end(fs.readFileSync(f))}
  if(p.startsWith('/api/'))return J(res,{rows:[]});res.writeHead(404);res.end('nf')})}).listen(+process.env.PORT||8788);
