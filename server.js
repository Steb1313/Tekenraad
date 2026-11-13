const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const {WebSocketServer}=require('ws');

/* ---------- woordenlijst ---------- */
const okWord=w=>/^[\p{L}][\p{L} -]{1,23}$/u.test(w);
let WORDS=[...new Set(`
hond kat paard koe varken schaap geit kip haan eend gans konijn muis rat olifant giraffe leeuw tijger beer ijsbeer wolf vos hert
eekhoorn egel mol kikker slang schildpad krokodil haai walvis dolfijn octopus krab kreeft vis zeepaard vlinder bij mier spin
lieveheersbeestje slak worm vleermuis uil adelaar pinguïn papegaai zwaan flamingo aap gorilla kameel zebra neushoorn nijlpaard
kangoeroe panda koala ezel pauw mus duif ooievaar libel mug vlieg schorpioen zeehond rog kwal zeester
appel banaan peer sinaasappel citroen druif aardbei kers ananas watermeloen wortel tomaat aardappel ui paprika komkommer broccoli
maïs champignon brood kaas ei melk boter pizza hamburger patat spaghetti soep taart koekje ijsje chocolade snoep stroopwafel
pannenkoek poffertjes haring worst frikandel pindakaas hagelslag popcorn pepermunt lolly donut sandwich salade rijst
huis deur raam dak trap tafel stoel bank bed kast lamp spiegel klok televisie computer telefoon toetsenbord koelkast oven pan bord
vork lepel mes kopje fles glas kaars sleutel slot bezem emmer douche bad toilet tandenborstel zeep handdoek kussen deken gordijn
schilderij boekenkast radio koffer paraplu bril horloge portemonnee
fiets auto bus trein tram vliegtuig helikopter boot schip onderzeeër raket motor scooter vrachtwagen tractor ambulance
brandweerwagen skateboard step luchtballon kar kano zeilboot
boom bloem roos tulp zon maan ster wolk regen sneeuw regenboog bliksem berg vulkaan rivier meer zee strand eiland woestijn bos gras
blad cactus paddenstoel duin waterval grot
voetbal basketbal tennis zwembad schaats ski gitaar piano trommel viool trompet microfoon camera boek pen potlood schaar rugzak
liniaal schoolbord wereldkaart
dokter leraar brandweerman politieagent kok boer piloot astronaut piraat clown ridder heks spook draak robot sneeuwpop prinses
koning kasteel
schoen laars sok broek jas muts sjaal handschoen jurk hoed pet trui
klomp windmolen dijk gracht kaaskop speculaas
ballon cadeau kroon schat anker vuur bom diamant brug toren kerk school ziekenhuis vlag munt geld hamer zaag ladder schop tent
kampvuur magneet zaklamp satelliet ufo tandarts
`.split(/[\s,]+/).filter(okWord))];
try{ // optioneel: eigen lijst, één woord per regel
  const f=fs.readFileSync(path.join(__dirname,'woorden.txt'),'utf8').split(/\r?\n/).map(s=>s.trim().toLowerCase()).filter(okWord);
  if(f.length>=50){WORDS=[...new Set(f)];console.log('woorden.txt geladen:',WORDS.length,'woorden');}
}catch{}

/* ---------- hulpfuncties ---------- */
const rooms=new Map(); let nextId=0,botCnt=0;
const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
function lev(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[a.length][b.length];}
const send=(p,o)=>{if(p.ws.readyState===1)p.ws.send(JSON.stringify(o));};
const broadcast=(r,o,except)=>{for(const p of r.players.values())if(p.id!==except)send(p,o);};
const sys=(r,text,cls)=>broadcast(r,{type:'chat',kind:'sys',cls,text});
const isLetter=c=>/[\p{L}\p{N}]/u.test(c);
const maskOf=r=>[...r.word].map((c,i)=>isLetter(c)?(r.revealed.has(i)?c:'_'):c).join('');
const clamp=(v,a,b,d)=>{v=Math.round(Number(v));return Number.isFinite(v)?Math.min(b,Math.max(a,v)):d;};
const validAvatar=a=>(typeof a==='string'&&a.length<=30000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(a))?a:'';

function newRoom(){
  let code;do{code=Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('');}while(rooms.has(code));
  const r={code,players:new Map(),hostId:null,test:false,
    settings:{rounds:3,time:80,choices:3,hints:2,max:8,custom:'',onlyCustom:false},
    state:'lobby',round:0,queue:[],drawerId:null,drawerName:'',word:'',revealed:new Set(),hintsGiven:0,ops:[],
    guessed:new Set(),gains:{},gainSum:0,gainList:[],timeLeft:0,used:new Set(),choices:[],
    votes:new Map(),gallery:[],banned:new Set()};
  r.timer=setInterval(()=>tick(r),1000);rooms.set(code,r);return r;
}
/* testmodus: twee bots die meespelen */
function addBots(r){
  for(const n of ['Bot Bram','Bot Lotte']){
    const b={id:++nextId,ws:{readyState:0},name:n,score:0,avatar:'',kicks:new Set(),bot:true};
    r.players.set(b.id,b);
  }
}
function roomInfo(r,p){
  const s=r.state,drawer=p.id===r.drawerId;
  let likes=0,dislikes=0;for(const v of r.votes.values()){if(v>0)likes++;else dislikes++;}
  return {type:'room',you:p.id,code:r.code,test:!!r.test,state:s,hostId:r.hostId,settings:r.settings,round:r.round,drawerId:r.drawerId,
    word:((s==='drawing'&&drawer)||s==='turnEnd')?r.word:null,
    mask:s==='drawing'?maskOf(r):'',len:[...r.word].filter(isLetter).length,time:r.timeLeft,gains:r.gainList,
    canKick:r.players.size>=3,need:Math.floor((r.players.size-1)/2)+1,
    myVote:r.votes.get(p.id)||0,likes:s==='turnEnd'?likes:null,dislikes:s==='turnEnd'?dislikes:null,
    players:[...r.players.values()].map(q=>({id:q.id,name:q.name,score:q.score,guessed:r.guessed.has(q.id),
      kicks:q.kicks.size,iKick:q.kicks.has(p.id)}))};
}
const sendRoom=r=>{for(const p of r.players.values())send(p,roomInfo(r,p));};

/* ---------- spelverloop ---------- */
function customList(r){return r.settings.custom.split(/[,\n]/).map(s=>s.trim().toLowerCase()).filter(okWord).slice(0,500);}
function pickWords(r){
  const c=customList(r),n=r.settings.choices;
  let pool=(r.settings.onlyCustom&&c.length>=n)?c:[...new Set([...WORDS,...c])];
  let free=pool.filter(w=>!r.used.has(w));
  if(free.length<n){r.used.clear();free=pool;}
  const out=[];while(out.length<n&&free.length){out.push(free.splice(Math.random()*free.length|0,1)[0]);}
  return out;
}
function startGame(r){
  for(const p of r.players.values())p.score=0;
  r.round=0;r.queue=[];r.used.clear();r.gallery=[];r.votes=new Map();nextTurn(r);
}
/* bewaar de tekening van de afgelopen beurt voor het eindoverzicht */
function archive(r){
  if(r.state!=='turnEnd'||!r.ops.length)return;
  let likes=0,dislikes=0;for(const v of r.votes.values()){if(v>0)likes++;else dislikes++;}
  r.gallery.push({drawer:r.drawerName,word:r.word,ops:r.ops.slice(),likes,dislikes,score:likes-dislikes});
}
function nextTurn(r){
  if(!r.players.size)return;
  archive(r);
  let id=null;
  while(id===null){
    if(!r.queue.length){
      r.round++;
      if(r.round>r.settings.rounds)return endGame(r);
      r.queue=[...r.players.keys()];
    }
    const c=r.queue.shift();if(r.players.has(c))id=c;
  }
  r.drawerId=id;r.drawerName=r.players.get(id).name;
  r.state='choosing';r.word='';r.revealed=new Set();r.hintsGiven=0;
  r.ops=[];r.guessed=new Set();r.gains={};r.gainSum=0;r.gainList=[];r.timeLeft=15;r.votes=new Map();
  r.choices=pickWords(r);
  broadcast(r,{type:'ops',ops:[]});
  sendRoom(r);
  send(r.players.get(id),{type:'choose',words:r.choices});
  sys(r,`${r.players.get(id).name} kiest een woord.`,'info');
}
function chooseWord(r,w){
  r.word=w;r.used.add(w);r.state='drawing';r.timeLeft=r.settings.time;
  r.revealed=new Set();r.hintsGiven=0;
  sendRoom(r);sys(r,'Er wordt getekend! Typ uw gok in de chat.','info');
  const d=r.players.get(r.drawerId);
  if(r.test&&d&&d.bot)sys(r,`🧪 Testmodus: het woord is "${w}".`,'warn');
}
function endTurn(r){
  if(r.state==='turnEnd')return;
  const d=r.players.get(r.drawerId);
  if(d){const g=Math.round(r.gainSum/Math.max(1,r.players.size-1));d.score+=g;r.gains[d.id]=g;}
  r.gainList=[...r.players.values()].map(q=>({name:q.name,gain:r.gains[q.id]||0})).sort((a,b)=>b.gain-a.gain);
  r.state='turnEnd';r.timeLeft=8;
  sendRoom(r);sys(r,`Het woord was: ${r.word}`,'info');
}
function endGame(r){
  const g=r.gallery;let best=null,worst=null;
  if(g.some(e=>e.likes||e.dislikes)){
    for(const e of g)if(!best||e.score>best.score)best=e;
    for(const e of g)if(e!==best&&(!worst||e.score<=worst.score))worst=e;
  }
  broadcast(r,{type:'results',best,worst});
  r.state='gameEnd';r.drawerId=null;r.word='';r.timeLeft=30;sendRoom(r);
}
function toLobby(r,msg){
  r.state='lobby';r.drawerId=null;r.word='';r.guessed=new Set();r.ops=[];r.votes=new Map();
  broadcast(r,{type:'ops',ops:[]});if(msg)sys(r,msg,'warn');sendRoom(r);
}
/* een speler (of bot) heeft het woord goed */
function correctGuess(r,p){
  const gain=Math.round(50+450*Math.max(0,r.timeLeft)/r.settings.time);
  p.score+=gain;r.gains[p.id]=gain;r.gainSum+=gain;r.guessed.add(p.id);
  sys(r,`${p.name} heeft het woord geraden! (+${gain})`,'ok');sendRoom(r);
  if([...r.players.keys()].every(id=>id===r.drawerId||r.guessed.has(id)))endTurn(r);
}
/* een bot tekent een paar krabbels per seconde */
function botDraw(r){
  const d=r.players.get(r.drawerId);if(!d||!d.bot)return;
  const cols=['#000000','#c1272d','#2f6fe0','#00a651','#ff6b00'];
  const s=Date.now()*1000+(botCnt++%1000),col=cols[Math.random()*cols.length|0];
  let x=100+Math.random()*600,y=100+Math.random()*400;
  for(let i=0;i<6;i++){
    const nx=Math.max(20,Math.min(780,x+(Math.random()-.5)*240)),ny=Math.max(20,Math.min(580,y+(Math.random()-.5)*240));
    const op={t:'l',x0:Math.round(x),y0:Math.round(y),x1:Math.round(nx),y1:Math.round(ny),col,w:8,s};
    if(r.ops.length<20000){r.ops.push(op);broadcast(r,{type:'op',op});}
    x=nx;y=ny;
  }
}
function tick(r){
  if(r.state==='lobby')return;
  r.timeLeft--;broadcast(r,{type:'time',t:Math.max(0,r.timeLeft)});
  if(r.state==='choosing'){
    const d=r.players.get(r.drawerId),botDrawer=!!(d&&d.bot);
    if(r.timeLeft<=0||(botDrawer&&r.timeLeft<=13))chooseWord(r,r.choices[botDrawer?0:Math.random()*r.choices.length|0]);
  }
  else if(r.state==='drawing'){
    const total=r.settings.hints,el=r.settings.time-r.timeLeft;
    if(r.hintsGiven<total&&el>=r.settings.time*(r.hintsGiven+1)/(total+1)){
      r.hintsGiven++;
      const pos=[...r.word].map((c,i)=>isLetter(c)&&!r.revealed.has(i)?i:-1).filter(i=>i>=0);
      const letters=[...r.word].filter(isLetter).length;
      if(pos.length&&r.revealed.size<Math.floor(letters/2)){r.revealed.add(pos[Math.random()*pos.length|0]);sendRoom(r);}
    }
    if(r.test){
      botDraw(r);
      if(el>=5)for(const q of [...r.players.values()]){
        if(r.state!=='drawing')break;
        if(q.bot&&q.id!==r.drawerId&&!r.guessed.has(q.id)&&Math.random()<0.05)correctGuess(r,q);
      }
    }
    if(r.state==='drawing'&&r.timeLeft<=0)endTurn(r);
  }
  else if(r.state==='turnEnd'){if(r.timeLeft<=0)nextTurn(r);}
  else if(r.state==='gameEnd'){if(r.timeLeft<=0)toLobby(r);}
}
function leave(r,p){
  if(!r.players.has(p.id))return; // al verwijderd (bijvoorbeeld na een votekick)
  r.players.delete(p.id);r.guessed.delete(p.id);
  for(const q of r.players.values())q.kicks.delete(p.id);
  const human=[...r.players.values()].find(q=>!q.bot);
  if(!human){clearInterval(r.timer);rooms.delete(r.code);return;}
  if(r.hostId===p.id)r.hostId=human.id;
  sys(r,`${p.name} heeft het spel verlaten.`,'warn');
  if(r.state==='choosing'||r.state==='drawing'||r.state==='turnEnd'){
    if(r.players.size<2)return toLobby(r,'Te weinig spelers: terug naar de lobby.');
    if(p.id===r.drawerId){if(r.state==='choosing')return nextTurn(r);if(r.state==='drawing')return endTurn(r);}
    if(r.state==='drawing'&&[...r.players.keys()].every(id=>id===r.drawerId||r.guessed.has(id)))return endTurn(r);
  }
  sendRoom(r);
}

/* ---------- server ---------- */
const server=http.createServer((req,res)=>{
  if(req.url==='/'||req.url.startsWith('/?')){
    fs.readFile(path.join(__dirname,'index.html'),(e,d)=>{
      if(e){res.writeHead(500);return res.end('index.html ontbreekt');}
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(d);});
  } else {res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server,maxPayload:60000});

wss.on('connection',ws=>{
  let room=null,p=null,lastMsg=0;
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m.t!=='string')return;
    const err=text=>ws.send(JSON.stringify({type:'error',text}));
    if(!room){
      const name=String(m.name||'').replace(/[<>]/g,'').trim().slice(0,16)||'Speler';
      if(m.t==='create')room=newRoom();
      else if(m.t==='join'){
        const r=rooms.get(String(m.code||'').toUpperCase().trim());
        if(!r)return err('Deze kamer bestaat niet.');
        if(r.players.size>=r.settings.max)return err('Deze kamer is vol.');
        if(r.banned.has(name.toLowerCase()))return err('U bent uit deze kamer weggestemd.');
        room=r;
      } else return;
      p={id:++nextId,ws,name,score:0,avatar:validAvatar(m.avatar),kicks:new Set()};
      room.players.set(p.id,p);if(!room.hostId)room.hostId=p.id;
      if(m.t==='create'&&m.test){room.test=true;addBots(room);}
      send(p,{type:'joined',id:p.id});send(p,{type:'ops',ops:room.ops});
      for(const q of room.players.values())if(q.avatar)send(p,{type:'avatar',id:q.id,avatar:q.avatar});
      if(p.avatar)broadcast(room,{type:'avatar',id:p.id,avatar:p.avatar},p.id);
      sys(room,`${name} is binnengekomen.`,'info');sendRoom(room);
      return;
    }
    const r=room,host=p.id===r.hostId;
    if(m.t==='settings'&&host&&r.state==='lobby'){
      const s=m.s||{};
      r.settings={rounds:clamp(s.rounds,1,10,3),time:clamp(s.time,30,180,80),choices:clamp(s.choices,1,5,3),
        hints:clamp(s.hints,0,4,2),max:clamp(s.max,Math.max(2,r.players.size),12,8),
        custom:String(s.custom||'').slice(0,5000),onlyCustom:!!s.onlyCustom};
      sendRoom(r);
    }
    else if(m.t==='start'&&host&&r.state==='lobby'){
      if(r.players.size<2)return err('U hebt minstens 2 spelers nodig.');
      startGame(r);
    }
    else if(m.t==='lobby'&&host&&r.state==='gameEnd'){
      toLobby(r);
    }
    else if(m.t==='choose'&&r.state==='choosing'&&p.id===r.drawerId){
      const w=r.choices[m.i|0];if(w)chooseWord(r,w);
    }
    else if(m.t==='vote'&&(r.state==='drawing'||r.state==='turnEnd')&&p.id!==r.drawerId){
      const v=m.v===1?1:m.v===-1?-1:0;
      if(v)r.votes.set(p.id,v);else r.votes.delete(p.id);
      sendRoom(r);
    }
    else if(m.t==='kick'){
      if(r.players.size<3)return;
      const t=r.players.get(Number(m.target));
      if(!t||t.id===p.id)return;
      if(t.kicks.has(p.id))t.kicks.delete(p.id);else t.kicks.add(p.id);
      const need=Math.floor((r.players.size-1)/2)+1;
      if(t.kicks.size>=need){
        r.banned.add(t.name.toLowerCase());
        send(t,{type:'kicked'});
        sys(r,`${t.name} is weggestemd door de andere spelers.`,'warn');
        leave(r,t);
        try{t.ws.close();}catch{}
      } else sendRoom(r);
    }
    else if(m.t==='draw'&&r.state==='drawing'&&p.id===r.drawerId){
      const o=m.op||{};const n=v=>Math.max(-10,Math.min(810,Number(v)||0));
      let op;
      if(o.t==='c')op={t:'c'};
      else{
        const col=/^#[0-9a-f]{6}$/i.test(o.col)?o.col:'#000000',s=Number(o.s)||0;
        if(o.t==='l')op={t:'l',x0:n(o.x0),y0:n(o.y0),x1:n(o.x1),y1:n(o.y1),col,w:Math.max(1,Math.min(60,Number(o.w)||8)),s};
        else if(o.t==='f')op={t:'f',x:Math.max(0,Math.min(799,o.x|0)),y:Math.max(0,Math.min(599,o.y|0)),col,s};
        else return;
      }
      if(op.t==='c')r.ops=[];else if(r.ops.length<20000)r.ops.push(op);
      broadcast(r,{type:'op',op},p.id);
    }
    else if(m.t==='undo'&&r.state==='drawing'&&p.id===r.drawerId){
      if(!r.ops.length)return;
      const s=r.ops[r.ops.length-1].s;r.ops=r.ops.filter(o=>o.s!==s);
      broadcast(r,{type:'ops',ops:r.ops});
    }
    else if(m.t==='chat'){
      const now=Date.now();if(now-lastMsg<400)return;lastMsg=now;
      const text=String(m.text||'').replace(/[<>]/g,'').trim().slice(0,100);if(!text)return;
      if(r.state==='drawing'){
        const knows=p.id===r.drawerId||r.guessed.has(p.id);
        if(knows){ // alleen zichtbaar voor wie het woord al weet
          for(const q of r.players.values())if(q.id===r.drawerId||r.guessed.has(q.id))send(q,{type:'chat',kind:'msg',cls:'ok',name:p.name,text});
          return;
        }
        const a=norm(text),b=norm(r.word);
        if(a===b){correctGuess(r,p);return;}
        if(lev(a,b)===1)send(p,{type:'chat',kind:'sys',cls:'warn',text:`"${text}" is bijna goed!`});
      }
      broadcast(r,{type:'chat',kind:'msg',name:p.name,text});
    }
  });
  ws.on('close',()=>{if(room&&p)leave(room,p);});
});

const port=process.env.PORT||3000;
server.listen(port,()=>{
  console.log(`Tekenraad draait op http://localhost:${port}`);
  for(const l of Object.values(os.networkInterfaces()))for(const i of l)
    if(i.family==='IPv4'&&!i.internal)console.log(`Op uw netwerk:        http://${i.address}:${port}`);
});