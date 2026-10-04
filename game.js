'use strict';
/* 太空金币冒险 v2 —— 纯静态 Canvas 游戏（无构建步骤）
   坐标系：画布左上角为原点，x 向右、y 向下，单位为 CSS 像素。 */
(()=>{
const $=id=>document.getElementById(id);
const cv=$('cv'),cx=cv.getContext('2d');
const clamp=(v,a,b)=>v<a?a:v>b?b:v,lerp=(a,b,t)=>a+(b-a)*t,rand=(a,b)=>a+Math.random()*(b-a),TAU=Math.PI*2;
const easeOutBack=t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);};
const easeOutCubic=t=>1-Math.pow(1-t,3),easeInOut=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const QS=new URLSearchParams(location.search);
const TEST=QS.get('test')==='1';

// ================= 存档（版本化 JSON + 备份键 + 解析失败回退）=================
const SAVE_KEY='sca2_save',SAVE_VER=1;
function defSave(){return{version:SAVE_VER,muted:false,music:true,shake:2,flash:true,ship:'guoguo',best:{guoguo:0,diandian:0},top:[],plays:0};}
function readSave(raw){const d=JSON.parse(raw);if(!d||typeof d!=='object'||typeof d.version!=='number')throw 0;if(d.version>SAVE_VER)throw 0;
  const s=defSave();s.muted=!!d.muted;s.music=d.music!==false;s.shake=[0,1,2].includes(d.shake)?d.shake:2;s.flash=d.flash!==false;
  s.ship=d.ship==='diandian'?'diandian':'guoguo';s.plays=Number.isFinite(d.plays)?d.plays:0;
  if(d.best&&typeof d.best==='object')for(const k of['guoguo','diandian'])s.best[k]=Number.isFinite(d.best[k])?Math.max(0,d.best[k]|0):0;
  if(Array.isArray(d.top))s.top=d.top.filter(r=>r&&Number.isFinite(r.score)&&(r.ship==='guoguo'||r.ship==='diandian')).slice(0,8);
  return s;}
function loadSave(){if(!localStorage.getItem(SAVE_KEY)&&matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){const d=defSave();d.shake=1;d.flash=false;try{if(!localStorage.getItem(SAVE_KEY+'_bak'))return d;}catch(e){return d;}}for(const k of[SAVE_KEY,SAVE_KEY+'_bak']){try{const raw=localStorage.getItem(k);if(raw)return readSave(raw);}catch(e){}}return defSave();}
const SV=loadSave();
function persist(){try{const prev=localStorage.getItem(SAVE_KEY);if(prev)localStorage.setItem(SAVE_KEY+'_bak',prev);localStorage.setItem(SAVE_KEY,JSON.stringify(SV));}catch(e){}}

// ================= 视口 / 安全区 =================
let W=innerWidth,H=innerHeight,DPR=1,K=1,safe={t:0,r:0,b:0,l:0},playTop=70,scoreTarget={x:0,y:0};
function readSafe(){const cs=getComputedStyle($('safeProbe'));safe={t:parseFloat(cs.paddingTop)||0,r:parseFloat(cs.paddingRight)||0,b:parseFloat(cs.paddingBottom)||0,l:parseFloat(cs.paddingLeft)||0};}
function measureHud(){const h=$('hud');if(getComputedStyle(h).display!=='none'){const r=h.getBoundingClientRect();playTop=r.bottom+6;const s=$('scoreBox').getBoundingClientRect();scoreTarget={x:s.left+20,y:s.top+s.height/2};}
  else{playTop=safe.t+66;scoreTarget={x:W/2,y:safe.t+28};}}

// ================= 声音：WebAudio 合成（来自羽毛球版的 iOS 保守解锁方案）=================
const AU={ctx:null,master:null,sfx:null,mus:null,noise:null,track:null,seq:null,broken:false,lastTry:0,bg:false};
const MASTER=0.85,MUSVOL=0.3;
const setSession=t=>{try{if(navigator.audioSession&&navigator.audioSession.type!==t)navigator.audioSession.type=t;}catch(e){}};
function audioBuild(){
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return false;
  try{AU.ctx=new AC({latencyHint:'interactive'});}catch(e){try{AU.ctx=new AC();}catch(e2){AU.ctx=null;return false;}}
  const c=AU.ctx;
  const comp=c.createDynamicsCompressor();comp.threshold.value=-14;comp.knee.value=10;comp.ratio.value=4;comp.attack.value=0.003;comp.release.value=0.2;comp.connect(c.destination);
  AU.master=c.createGain();AU.master.gain.value=SV.muted?0:MASTER;AU.master.connect(comp);
  AU.sfx=c.createGain();AU.sfx.gain.value=1;AU.sfx.connect(AU.master);
  AU.mus=c.createGain();AU.mus.gain.value=MUSVOL;AU.mus.connect(AU.master);
  AU.noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const d=AU.noise.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  c.onstatechange=()=>{if(c.state!=='running')return;AU.broken=false;if(AU.bg||document.hidden){c.suspend().catch(()=>{});return;}musicSync();};
  return true;}
// 只能在用户手势（touchend/click/pointerdown/keydown）里调用；切回前台后也只在下一次点按时恢复
function audioUnlock(){
  if(document.hidden)return;
  setSession('playback');                       // iOS：静音键打开时也能出声（仅前台 + 点按后）
  if(AU.bg){AU.bg=false;if(AU.master){const t=AU.ctx.currentTime;AU.master.gain.cancelScheduledValues(t);AU.master.gain.setValueAtTime(SV.muted?0:MASTER,t);}}
  if(AU.broken&&AU.ctx){try{AU.ctx.close();}catch(e){}AU.ctx=null;if(AU.seq)AU.seq.stop();AU.seq=null;AU.track=null;}
  if(AU.ctx&&AU.ctx.state==='closed')AU.ctx=null;
  if(!AU.ctx&&!audioBuild())return;
  const c=AU.ctx;
  try{const b=c.createBufferSource();b.buffer=c.createBuffer(1,1,22050);b.connect(c.destination);b.start(0);}catch(e){}
  if(c.state!=='running'){                     // 'suspended' 或 iOS 的 'interrupted'
    const p=c.resume();if(p&&p.then)p.then(musicSync).catch(()=>{});
    const t=performance.now();AU.lastTry=t;
    setTimeout(()=>{if(AU.ctx===c&&c.state!=='running'&&!document.hidden&&AU.lastTry===t)AU.broken=true;},600);
  }else musicSync();}
// 后台/锁屏/切 App：静音、停音乐、挂起、释放音频会话
function audioToBackground(){AU.bg=true;
  if(AU.seq){AU.seq.stop();AU.seq=null;}AU.track=null;
  if(AU.ctx&&AU.master){const t=AU.ctx.currentTime;AU.master.gain.cancelScheduledValues(t);AU.master.gain.value=0;AU.master.gain.setValueAtTime(0,t);}
  if(AU.ctx&&AU.ctx.state!=='closed'&&AU.ctx.state!=='suspended'){const p=AU.ctx.suspend();if(p&&p.catch)p.catch(()=>{});}
  setSession('auto');}
const aok=()=>AU.ctx&&AU.ctx.state==='running'&&!AU.bg&&!document.hidden;
const NOTE=m=>440*Math.pow(2,(m-69)/12);
function env(g,t,a,peak,dur){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);}
function tone(freq,dur,type,vol,delay,f2,dest){const c=AU.ctx,t=c.currentTime+(delay||0);const o=c.createOscillator(),g=c.createGain();
  o.type=type||'sine';o.frequency.setValueAtTime(freq,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+dur);
  env(g,t,0.006,vol,dur);o.connect(g).connect(dest||AU.sfx);o.start(t);o.stop(t+dur+0.03);}
function noise(dur,fq,q,vol,type,delay,f2,dest){const c=AU.ctx,t=c.currentTime+(delay||0);const s=c.createBufferSource();s.buffer=AU.noise;
  const f=c.createBiquadFilter();f.type=type||'bandpass';f.frequency.setValueAtTime(fq,t);if(f2)f.frequency.exponentialRampToValueAtTime(f2,t+dur);f.Q.value=q||1;const g=c.createGain();
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);s.connect(f).connect(g).connect(dest||AU.sfx);s.start(t,Math.random()*0.6);s.stop(t+dur+0.03);}
function duck(amount,hold){if(!AU.mus)return;const t=AU.ctx.currentTime,g=AU.mus.gain;g.cancelScheduledValues(t);g.setTargetAtTime(MUSVOL*amount,t,0.02);g.setTargetAtTime(MUSVOL,t+hold,0.25);}
const PENTA=[0,2,4,7,9];
let lastCoinSfx=0;
function sfx(name,p){if(!aok()||SV.muted)return;const now=AU.ctx.currentTime;
  switch(name){
  case 'coin':{if(now-lastCoinSfx<0.028)return;lastCoinSfx=now;const s=Math.min(p||0,12);const m=76+PENTA[s%5]+12*Math.floor(s/5);
    tone(NOTE(m),0.05,'square',0.045);tone(NOTE(m+7),0.13,'triangle',0.1,0.03);break;}
  case 'gem':[0,4,7,12,16].forEach((d,i)=>tone(NOTE(81+d),0.16,'triangle',0.09,i*0.045));noise(0.35,9000,0.7,0.05,'highpass',0.05);break;
  case 'set':[0,4,7,12].forEach((d,i)=>{tone(NOTE(76+d),0.12,'square',0.04,i*0.06);tone(NOTE(88+d),0.18,'triangle',0.06,i*0.06);});break;
  case 'combo':{const b=72+(p||0)*2;[0,4,7,12].forEach((d,i)=>tone(NOTE(b+d),0.12,'square',0.05,i*0.05));break;}
  case 'power':tone(NOTE(60),0.4,'square',0.035,0,NOTE(84));[0,4,7,12,16].forEach((d,i)=>tone(NOTE(72+d),0.14,'triangle',0.09,0.08+i*0.05));break;
  case 'heart':[72,76,79,84].forEach((m,i)=>tone(NOTE(m),0.2,'sine',0.14,i*0.07));break;
  case 'shieldBreak':noise(0.4,5000,0.7,0.22,'highpass');tone(1100,0.3,'triangle',0.12,0,260);break;
  case 'hit':tone(170,0.24,'sine',0.5,0,45);noise(0.2,1100,0.9,0.4,'bandpass',0,260);tone(520,0.32,'square',0.05,0.03,130);duck(0.3,0.4);break;
  case 'drone':tone(NOTE(79),0.1,'triangle',0.11);tone(NOTE(86),0.22,'triangle',0.11,0.08);noise(0.3,1500,0.6,0.07,'bandpass',0,7000);break;
  case 'droneLost':tone(700,0.22,'square',0.05,0,160);noise(0.22,1600,1,0.16);break;
  case 'laser':tone(1500,0.32,'sawtooth',0.035,0,160);tone(760,0.34,'square',0.035,0,90);noise(0.32,3500,0.5,0.07,'bandpass',0,500);break;
  case 'burn':noise(0.22,2600,0.8,0.12,'bandpass',0,700);break;
  case 'boss':for(let i=0;i<4;i++)tone(i%2?740:554,0.2,'square',0.06,i*0.22);tone(80,1.1,'triangle',0.35,0,38);duck(0.2,1.2);break;
  case 'warn':tone(988,0.07,'sine',0.13);tone(988,0.07,'sine',0.13,0.13);break;
  case 'throw':noise(0.32,700,1.2,0.2,'bandpass',0,3200);break;
  case 'stamp':tone(130,0.22,'sine',0.5,0,48);noise(0.16,700,1,0.35,'lowpass');break;
  case 'tick':tone(NOTE(93),0.045,'square',0.05);break;
  case 'bell':[0,0.32].forEach(d=>{tone(NOTE(88),0.6,'sine',0.16,d);tone(NOTE(95),0.5,'sine',0.06,d);});break;
  case 'win':[72,76,79,84,79,84,88].forEach((m,i)=>{tone(NOTE(m),0.2,'square',0.05,i*0.11);tone(NOTE(m),0.3,'triangle',0.1,i*0.11);});break;
  case 'lose':[67,66,65,64].forEach((m,i)=>tone(NOTE(m),i===3?0.6:0.26,'triangle',0.14,i*0.25,i===3?NOTE(58):0));break;
  case 'click':tone(NOTE(84),0.05,'triangle',0.09);break;
  case 'select':tone(NOTE(79),0.07,'square',0.04);tone(NOTE(86),0.12,'triangle',0.09,0.05);break;
  case 'launch':noise(0.9,300,0.7,0.28,'lowpass',0,2600);tone(110,0.8,'sawtooth',0.04,0,520);break;
  case 'banner':noise(0.4,900,0.8,0.09,'bandpass',0,4500);break;
  case 'rain':[0,4,7,12,16,19,24].forEach((d,i)=>tone(NOTE(79+d),0.14,'triangle',0.07,i*0.05));break;
  }}
// ---- 背景音乐：前瞻式步进音序器；后台绝不排音符 ----
const CH_PLAY=[[60,64,67],[55,59,62],[57,60,64],[53,57,60]];
const CH_MENU=[[53,57,60,64],[55,59,62,65],[52,55,59,62],[57,60,64,67]];
const CH_BOSS=[[57,60,64],[53,57,60],[55,59,62],[52,56,59]];
const MA=[72,0,76,0,79,76,74,72, 74,0,71,0,74,79,77,74, 76,0,72,0,76,81,79,76, 77,76,74,72,74,0,0,0];
const MB=[79,0,79,81,79,76,74,0, 74,0,74,76,74,71,67,0, 72,0,76,79,84,0,81,79, 77,0,76,0,74,0,72,0];
const MC=[72,74,76,79,76,74,72,0, 71,72,74,79,74,72,71,0, 69,71,72,76,72,71,69,0, 65,67,69,72,74,76,77,79];
const MEL_PLAY=[MA,MB,MA,MC];
const MEL_MENU=[[77,0,0,76,0,0,72,0, 74,0,0,0,0,0,0,0, 76,0,0,72,0,0,69,0, 71,0,0,0,0,0,0,0],[77,0,0,79,0,0,81,0, 79,0,0,77,76,0,0,0, 76,0,0,74,0,0,72,0, 69,0,0,0,0,0,0,0]];
const MEL_BOSS=[[69,0,72,69,76,0,74,72, 69,0,72,69,77,0,76,72, 71,0,74,71,79,0,77,74, 76,0,75,0,76,0,0,0],[81,0,79,0,77,0,76,0, 77,0,76,0,74,0,72,0, 74,0,72,0,71,0,69,0, 68,0,71,0,76,0,0,0]];
let musicHot=0;
function startSeq(kind){const c=AU.ctx,bpm=kind==='play'?124:kind==='boss'?138:92,step=60/bpm/2;let next=c.currentTime+0.08,i=0,stopped=false,timer=null,self=null;
  const mel=kind==='play'?MEL_PLAY:kind==='boss'?MEL_BOSS:MEL_MENU,CH=kind==='play'?CH_PLAY:kind==='boss'?CH_BOSS:CH_MENU;
  function note(m,t,dur,type,vol,lpf){const o=c.createOscillator(),g=c.createGain(),f=c.createBiquadFilter();o.type=type;o.frequency.setValueAtTime(NOTE(m),t);
    f.type='lowpass';f.frequency.value=lpf;g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(f).connect(g).connect(AU.mus);o.start(t);o.stop(t+dur+0.02);}
  function hat(t,vol){const s=c.createBufferSource();s.buffer=AU.noise;const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=7000;const g=c.createGain();
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+0.04);s.connect(f).connect(g).connect(AU.mus);s.start(t,Math.random()*0.5);s.stop(t+0.05);}
  function snare(t,vol){const s=c.createBufferSource();s.buffer=AU.noise;const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=1800;f.Q.value=0.7;const g=c.createGain();
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0001,t+0.12);s.connect(f).connect(g).connect(AU.mus);s.start(t,Math.random()*0.5);s.stop(t+0.13);}
  function kick(t){const o=c.createOscillator(),g=c.createGain();o.frequency.setValueAtTime(140,t);o.frequency.exponentialRampToValueAtTime(45,t+0.12);
    g.gain.setValueAtTime(0.55,t);g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);o.connect(g).connect(AU.mus);o.start(t);o.stop(t+0.18);}
  function tick(){if(stopped)return;
    if(document.hidden||AU.bg||c.state!=='running'){stopped=true;if(AU.seq===self){AU.seq=null;AU.track=null;}return;}
    if(next<c.currentTime-0.2)next=c.currentTime+0.05;
    while(next<c.currentTime+0.12){const bar=Math.floor(i/8)%4,ch=CH[bar],s=i%8,ph=Math.floor(i/32)%mel.length;
      if(kind==='menu'){if(s===0)ch.forEach(m=>note(m,next,step*7.5,'sine',0.06,900));if(s===0||s===4)note(ch[0]-12,next,step*3,'triangle',0.3,500);
        note(ch[s%ch.length]+24,next,step*0.9,'triangle',0.045,2200);}
      else{const boss=kind==='boss',hot=musicHot>0;
        if(s===0||s===4||(boss&&s===6))kick(next);if(s===2||s===6)snare(next,boss?0.16:0.11);if(s%2===1)hat(next,hot?0.12:0.07);else if(hot||boss)hat(next,0.045);
        if(s===0||s===3||s===4||s===6)note(ch[0]-12+(s===6?12:0),next,step*1.6,boss?'sawtooth':'triangle',boss?0.12:0.4,boss?500:700);
        if(s===2||s===6)ch.slice(1).forEach(m=>note(m+12,next,step*0.9,'square',0.03,1600));
        if(hot)note(ch[s%3]+24,next,step*0.8,'triangle',0.05,3000);}
      const m=mel[ph][i%32];if(m&&(kind!=='menu'||s%2===0||m))note(m,next,step*(kind==='menu'?2.4:1.1),kind==='menu'?'triangle':'square',kind==='menu'?0.09:0.055,kind==='menu'?3000:2400);
      i++;next+=step;}
    timer=setTimeout(tick,25);}
  self={stop(){stopped=true;clearTimeout(timer);}};tick();return self;}
function musicWant(){if(!SV.music||SV.muted)return null;
  if(mode==='title')return 'menu';
  if(mode==='play'&&!paused&&!G.ending)return G.boss?'boss':'play';
  if(mode==='over')return overT>2.6?'menu':null;
  return null;}
function musicSync(){if(!AU.ctx)return;const want=aok()?musicWant():null;if(want===AU.track&&(!want||AU.seq))return;
  if(AU.seq){AU.seq.stop();AU.seq=null;}AU.track=want;if(want)AU.seq=startSeq(want);}
function setMuted(v){SV.muted=v;persist();for(const b of document.querySelectorAll('.mute')){b.classList.toggle('muted',v);b.setAttribute('aria-label',v?'打开声音':'静音');}
  if(AU.master){const t=AU.ctx.currentTime;AU.master.gain.cancelScheduledValues(t);AU.master.gain.setTargetAtTime(v?0:MASTER,t,0.03);}
  if(!v)audioUnlock();musicSync();syncSettingsUI();}

// ================= 美术：离屏预渲染精灵（发光直接烘进贴图，避免每帧 shadowBlur）=================
const mk=(w,h)=>{const c=document.createElement('canvas');c.width=Math.max(1,Math.ceil(w));c.height=Math.max(1,Math.ceil(h));return c;};
const SPR={coin:[],gem:null,books:[],bigBook:null,pow:{},bg:null,planet:null,moon:null};
const COIN_FR=16;
function star5(x,cx0,cy0,ro,ri){x.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?ri:ro;x.lineTo(cx0+Math.cos(a)*r,cy0+Math.sin(a)*r);}x.closePath();}
function rr(x,X,Y,w,h,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();}
function buildCoin(r,ph){const S=r*2.8,c=mk(S*DPR,S*DPR),x=c.getContext('2d');x.scale(DPR,DPR);x.translate(S/2,S/2);
  const gl=x.createRadialGradient(0,0,r*.5,0,0,r*1.4);gl.addColorStop(0,'rgba(255,220,100,.55)');gl.addColorStop(1,'rgba(255,200,80,0)');x.fillStyle=gl;x.beginPath();x.arc(0,0,r*1.4,0,TAU);x.fill();
  const cs=Math.cos(ph),sx=Math.max(.12,Math.abs(cs)),th=r*.16*(1-sx*.6);
  x.save();x.translate(cs>=0?th:-th,0);x.scale(sx,1);x.fillStyle='#b65f00';x.beginPath();x.arc(0,0,r,0,TAU);x.fill();x.restore();
  x.save();x.scale(sx,1);
  const g=x.createRadialGradient(-r*.35,-r*.4,r*.1,0,0,r);g.addColorStop(0,'#fff8cf');g.addColorStop(.35,'#ffd95a');g.addColorStop(.8,'#f5a416');g.addColorStop(1,'#d97f00');
  x.fillStyle=g;x.beginPath();x.arc(0,0,r,0,TAU);x.fill();
  x.lineWidth=r*.12;x.strokeStyle='#e89000';x.beginPath();x.arc(0,0,r*.74,0,TAU);x.stroke();
  star5(x,0,0,r*.5,r*.22);x.fillStyle='#ffe97f';x.fill();x.lineWidth=r*.07;x.strokeStyle='#c46f00';x.stroke();
  x.globalAlpha=.75;x.fillStyle='#fff';x.beginPath();x.ellipse(-r*.4,-r*.45,r*.22,r*.11,-.7,0,TAU);x.fill();
  x.restore();return c;}
function buildGem(r){const S=r*3,c=mk(S*DPR,S*DPR),x=c.getContext('2d');x.scale(DPR,DPR);x.translate(S/2,S/2);
  const gl=x.createRadialGradient(0,0,r*.4,0,0,r*1.5);gl.addColorStop(0,'rgba(255,140,220,.6)');gl.addColorStop(1,'rgba(160,120,255,0)');x.fillStyle=gl;x.beginPath();x.arc(0,0,r*1.5,0,TAU);x.fill();
  star5(x,0,r*.05,r*1.05,r*.5);const g=x.createLinearGradient(0,-r,0,r);g.addColorStop(0,'#fff0a0');g.addColorStop(.45,'#ff9ad5');g.addColorStop(1,'#8f6bff');x.fillStyle=g;x.fill();
  x.lineJoin='round';x.lineWidth=r*.12;x.strokeStyle='#fff';x.stroke();
  x.fillStyle='#4b2f8f';x.font=`900 ${r*.62}px system-ui,sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText('5',0,r*.12);return c;}
const BOOKCOL=[['#ff5d6c','#c8304a'],['#5b8cff','#3557c9'],['#3ccf8e','#21946a'],['#ffa53d','#d1701a']];
function buildBook(r,col,label){const w=r*1.55,h=r*1.95,S=Math.max(w,h)*1.25,c=mk(S*DPR,S*DPR),x=c.getContext('2d');x.scale(DPR,DPR);x.translate(S/2,S/2);
  x.fillStyle='rgba(20,8,60,.35)';rr(x,-w/2+3,-h/2+4,w,h,r*.14);x.fill();
  x.fillStyle='#f6f1e4';rr(x,-w/2+r*.12,-h/2+r*.06,w,h,r*.12);x.fill();
  x.fillStyle=col[0];rr(x,-w/2,-h/2,w-r*.1,h-r*.08,r*.14);x.fill();
  x.fillStyle=col[1];rr(x,-w/2,-h/2,r*.28,h-r*.08,r*.1);x.fill();
  x.fillStyle='#fff3d9';rr(x,-w*.22,-h*.36,w*.62,h*.3,r*.1);x.fill();
  x.fillStyle='#2a1e5e';x.font=`900 ${r*(label.length>2?.34:.46)}px "PingFang SC","Microsoft YaHei",sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText(label,w*.09,-h*.21);
  // 气呼呼的小脸
  const fy=h*.17;x.fillStyle='#2a1e5e';x.beginPath();x.arc(w*-.04,fy,r*.09,0,TAU);x.arc(w*.24,fy,r*.09,0,TAU);x.fill();
  x.strokeStyle='#2a1e5e';x.lineWidth=r*.08;x.lineCap='round';x.beginPath();x.moveTo(w*-.13,fy-r*.24);x.lineTo(w*.03,fy-r*.14);x.moveTo(w*.33,fy-r*.24);x.lineTo(w*.17,fy-r*.14);x.stroke();
  x.beginPath();x.arc(w*.1,fy+r*.3,r*.13,Math.PI*1.15,Math.PI*1.85);x.stroke();
  return c;}
const POW={magnet:{c:'#ff6b7d',name:'磁铁',ico:'磁'},shield:{c:'#5fc6ff',name:'护盾',ico:'盾'},double:{c:'#ffcb47',name:'双倍',ico:'×2'},heart:{c:'#ff7fb0',name:'爱心',ico:'♥'}};
function drawPowIcon(x,type,r){x.save();x.lineCap='round';x.lineJoin='round';
  if(type==='magnet'){x.lineWidth=r*.34;x.strokeStyle='#ff3d57';x.beginPath();x.arc(0,-r*.05,r*.42,Math.PI,0);x.lineTo(r*.42,r*.38);x.moveTo(-r*.42,-r*.05);x.lineTo(-r*.42,r*.38);x.stroke();
    x.strokeStyle='#e8ecff';x.beginPath();x.moveTo(-r*.42,r*.22);x.lineTo(-r*.42,r*.42);x.moveTo(r*.42,r*.22);x.lineTo(r*.42,r*.42);x.stroke();}
  else if(type==='shield'){x.beginPath();x.moveTo(0,-r*.55);x.quadraticCurveTo(r*.5,-r*.42,r*.5,-r*.35);x.quadraticCurveTo(r*.5,r*.25,0,r*.58);x.quadraticCurveTo(-r*.5,r*.25,-r*.5,-r*.35);x.quadraticCurveTo(-r*.5,-r*.42,0,-r*.55);
    x.fillStyle='#3aa6ff';x.fill();x.lineWidth=r*.1;x.strokeStyle='#e8f6ff';x.stroke();x.fillStyle='#e8f6ff';star5(x,0,0,r*.24,r*.1);x.fill();}
  else if(type==='double'){x.fillStyle='#b4500c';x.font=`900 ${r*.8}px system-ui,sans-serif`;x.textAlign='center';x.textBaseline='middle';x.fillText('×2',0,r*.06);}
  else{x.fillStyle='#ff4f8a';x.beginPath();x.moveTo(0,r*.5);x.bezierCurveTo(-r*.75,0,-r*.45,-r*.6,0,-r*.22);x.bezierCurveTo(r*.45,-r*.6,r*.75,0,0,r*.5);x.fill();}
  x.restore();}
function buildPow(type,r){const S=r*3,c=mk(S*DPR,S*DPR),x=c.getContext('2d');x.scale(DPR,DPR);x.translate(S/2,S/2);const col=POW[type].c;
  const gl=x.createRadialGradient(0,0,r*.6,0,0,r*1.5);gl.addColorStop(0,col+'aa');gl.addColorStop(1,col+'00');x.fillStyle=gl;x.beginPath();x.arc(0,0,r*1.5,0,TAU);x.fill();
  const g=x.createRadialGradient(-r*.3,-r*.35,r*.1,0,0,r);g.addColorStop(0,'#ffffff');g.addColorStop(.5,'#fff7ea');g.addColorStop(1,col);x.fillStyle=g;x.beginPath();x.arc(0,0,r,0,TAU);x.fill();
  x.lineWidth=r*.1;x.strokeStyle='#ffffff';x.stroke();drawPowIcon(x,type,r);
  x.globalAlpha=.8;x.fillStyle='#fff';x.beginPath();x.ellipse(-r*.42,-r*.48,r*.2,r*.1,-.7,0,TAU);x.fill();return c;}
function buildPlanet(r){const S=r*3.2,c=mk(S,S),x=c.getContext('2d');x.translate(S/2,S/2);
  x.save();x.rotate(-.35);x.strokeStyle='rgba(255,200,140,.45)';x.lineWidth=r*.12;x.beginPath();x.ellipse(0,0,r*1.55,r*.38,0,Math.PI,TAU);x.stroke();x.restore();
  const g=x.createRadialGradient(-r*.4,-r*.4,r*.1,0,0,r);g.addColorStop(0,'#ffb38a');g.addColorStop(.55,'#e2657e');g.addColorStop(1,'#6b2f8f');x.fillStyle=g;x.beginPath();x.arc(0,0,r,0,TAU);x.fill();
  x.save();x.beginPath();x.arc(0,0,r,0,TAU);x.clip();x.globalAlpha=.25;x.fillStyle='#ffe0c0';for(let i=0;i<4;i++){x.fillRect(-r,-r*.6+i*r*.38,r*2,r*.1);}x.restore();
  x.save();x.rotate(-.35);x.strokeStyle='rgba(255,215,160,.7)';x.lineWidth=r*.12;x.beginPath();x.ellipse(0,0,r*1.55,r*.38,0,0,Math.PI);x.stroke();x.restore();return c;}
function buildMoon(r){const S=r*2.4,c=mk(S,S),x=c.getContext('2d');x.translate(S/2,S/2);const g=x.createRadialGradient(-r*.3,-r*.3,r*.1,0,0,r);g.addColorStop(0,'#d6fff4');g.addColorStop(1,'#3aa5a0');
  x.fillStyle=g;x.beginPath();x.arc(0,0,r,0,TAU);x.fill();x.fillStyle='rgba(30,90,110,.35)';[[.3,-.2,.22],[-.35,.3,.16],[.1,.45,.12]].forEach(([a,b,s])=>{x.beginPath();x.arc(a*r,b*r,s*r,0,TAU);x.fill();});return c;}
function buildBg(){const c=mk(W*DPR,H*DPR),x=c.getContext('2d');x.scale(DPR,DPR);
  const g=x.createLinearGradient(0,0,0,H);g.addColorStop(0,'#1d1556');g.addColorStop(.55,'#33207c');g.addColorStop(1,'#4c2a86');x.fillStyle=g;x.fillRect(0,0,W,H);
  const blob=(px,py,rad,col)=>{const r=x.createRadialGradient(px,py,0,px,py,rad);r.addColorStop(0,col);r.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=r;x.fillRect(px-rad,py-rad,rad*2,rad*2);};
  const m=Math.max(W,H);blob(W*.15,H*.25,m*.45,'rgba(255,111,174,.16)');blob(W*.9,H*.55,m*.5,'rgba(53,217,187,.12)');blob(W*.5,H*1.05,m*.55,'rgba(255,203,71,.12)');blob(W*.75,H*.05,m*.3,'rgba(120,140,255,.14)');
  SPR.bg=c;}
function buildSprites(){
  SPR.coinR=14*K;SPR.coin=[];for(let i=0;i<COIN_FR;i++)SPR.coin.push(buildCoin(SPR.coinR,i/COIN_FR*TAU));
  SPR.gemR=19*K;SPR.gem=buildGem(SPR.gemR);
  SPR.bookR=22*K;SPR.books=BOOKCOL.map(col=>buildBook(SPR.bookR,col,'作业'));SPR.bigBook=buildBook(SPR.bookR*1.5,['#b16cff','#7a3fd0'],'寒假作业');
  SPR.powR=19*K;for(const t in POW)SPR.pow[t]=buildPow(t,SPR.powR);
  SPR.planetR=Math.max(46,Math.min(W,H)*.12);SPR.planet=buildPlanet(SPR.planetR);SPR.moon=buildMoon(Math.max(22,Math.min(W,H)*.06));
  buildBg();}
function blit(img,x,y,scale,rot,alpha){const w=img.width/DPR*scale,h=img.height/DPR*scale;
  if(rot||alpha!==undefined){cx.save();cx.translate(x,y);if(rot)cx.rotate(rot);if(alpha!==undefined)cx.globalAlpha=alpha;cx.drawImage(img,-w/2,-h/2,w,h);cx.restore();}
  else cx.drawImage(img,x-w/2,y-h/2,w,h);}

// ---- 角色：果果号（桃子造型 + 小叶子天线）/ 点点号（波点飞碟）。实时绘制，便于表情和形变 ----
function face(x,fx,fy,s,mood,hair,clip){
  x.fillStyle='#ffe0c7';x.beginPath();x.arc(fx,fy,8.6*s,0,TAU);x.fill();
  x.fillStyle=hair;x.beginPath();x.arc(fx,fy-1.2*s,8.9*s,Math.PI*1.03,Math.PI*1.97);x.quadraticCurveTo(fx+3*s,fy-3*s,fx-1*s,fy-5.5*s);x.quadraticCurveTo(fx-5*s,fy-3*s,fx-8.8*s,fy-2*s);x.fill();
  if(clip){x.fillStyle=clip;x.beginPath();x.arc(fx+5.8*s,fy-6*s,2.3*s,0,TAU);x.fill();}
  x.fillStyle='#ff9fb1';x.globalAlpha=.8;x.beginPath();x.arc(fx-5.2*s,fy+2.4*s,1.8*s,0,TAU);x.arc(fx+5.2*s,fy+2.4*s,1.8*s,0,TAU);x.fill();x.globalAlpha=1;
  x.strokeStyle='#3a2340';x.fillStyle='#3a2340';x.lineWidth=1.5*s;x.lineCap='round';
  if(mood==='ouch'){x.beginPath();x.moveTo(fx-5*s,fy-1.5*s);x.lineTo(fx-2.4*s,fy);x.lineTo(fx-5*s,fy+1.4*s);x.moveTo(fx+5*s,fy-1.5*s);x.lineTo(fx+2.4*s,fy);x.lineTo(fx+5*s,fy+1.4*s);x.stroke();
    x.beginPath();x.ellipse(fx,fy+4.2*s,1.6*s,1.9*s,0,0,TAU);x.fill();}
  else if(mood==='happy'){x.beginPath();x.arc(fx-3.4*s,fy+.6*s,1.8*s,Math.PI*1.1,Math.PI*1.9);x.moveTo(fx+5.2*s,fy+.2*s);x.arc(fx+3.4*s,fy+.6*s,1.8*s,Math.PI*1.1,Math.PI*1.9);x.stroke();
    x.beginPath();x.arc(fx,fy+2.6*s,2.8*s,.15*Math.PI,.85*Math.PI);x.fill();}
  else{x.beginPath();x.arc(fx-3.4*s,fy,1.35*s,0,TAU);x.arc(fx+3.4*s,fy,1.35*s,0,TAU);x.fill();x.beginPath();x.arc(fx,fy+2.6*s,2.4*s,.2*Math.PI,.8*Math.PI);x.stroke();}}
function drawShip(x,type,px,py,s,o){o=o||{};const t=o.t||0,tilt=o.tilt||0,sx=o.sx||1,sy=o.sy||1,mood=o.mood||'idle',thr=o.thrust===undefined?1:o.thrust;
  x.save();x.translate(px,py);x.rotate(tilt);x.scale(s*sx,s*sy);
  if(type==='guoguo'){
    const fl=(16+Math.sin(t*40)*3+Math.sin(t*23)*2)*(.6+thr*.6);
    let g=x.createLinearGradient(0,16,0,16+fl);g.addColorStop(0,'#fff6b0');g.addColorStop(.4,'#ffb13b');g.addColorStop(1,'rgba(255,90,60,0)');
    x.fillStyle=g;x.beginPath();x.moveTo(-8,15);x.quadraticCurveTo(0,16+fl*1.2,8,15);x.closePath();x.fill();
    x.fillStyle='#e8664a';x.beginPath();x.moveTo(-17,4);x.quadraticCurveTo(-31,14,-26,22);x.quadraticCurveTo(-18,18,-12,15);x.closePath();x.moveTo(17,4);x.quadraticCurveTo(31,14,26,22);x.quadraticCurveTo(18,18,12,15);x.closePath();x.fill();
    g=x.createRadialGradient(-7,-9,3,0,0,24);g.addColorStop(0,'#ffd2a8');g.addColorStop(.55,'#ff9a5e');g.addColorStop(1,'#f0613f');
    x.fillStyle=g;x.beginPath();x.moveTo(0,-22);x.bezierCurveTo(14,-26,24,-12,22,2);x.bezierCurveTo(20,16,10,20,0,20);x.bezierCurveTo(-10,20,-20,16,-22,2);x.bezierCurveTo(-24,-12,-14,-26,0,-22);x.fill();
    x.strokeStyle='rgba(200,70,40,.45)';x.lineWidth=2;x.beginPath();x.moveTo(0,-21);x.quadraticCurveTo(-6,0,0,19);x.stroke();
    x.strokeStyle='#7a4a2a';x.lineWidth=2.4;x.lineCap='round';x.beginPath();x.moveTo(0,-21);x.lineTo(1,-28);x.stroke();
    x.save();x.translate(1,-28);x.rotate(-.6+Math.sin(t*5)*.25);x.fillStyle='#4fcf6a';x.beginPath();x.ellipse(7,0,8,3.6,0,0,TAU);x.fill();x.strokeStyle='#2f9a48';x.lineWidth=1;x.beginPath();x.moveTo(0,0);x.lineTo(13,0);x.stroke();x.restore();
    x.fillStyle='#2b2466';x.beginPath();x.arc(0,-1,12.2,0,TAU);x.fill();x.lineWidth=2.6;x.strokeStyle='#fff3d9';x.stroke();
    x.save();x.beginPath();x.arc(0,-1,11,0,TAU);x.clip();face(x,0,1,1,mood,'#4a2b3a',null);x.restore();
    x.globalAlpha=.55;x.fillStyle='#fff';x.beginPath();x.ellipse(-12,-11,4,2.2,-.7,0,TAU);x.fill();x.globalAlpha=1;
  }else{
    const fl=(11+Math.sin(t*44)*2.5)*(.6+thr*.6);
    for(const jx of[-10,10]){const g=x.createLinearGradient(0,10,0,12+fl);g.addColorStop(0,'#e6fffb');g.addColorStop(.4,'#5ff0d4');g.addColorStop(1,'rgba(60,140,255,0)');
      x.fillStyle=g;x.beginPath();x.moveTo(jx-4.5,11);x.quadraticCurveTo(jx,12+fl*1.25,jx+4.5,11);x.closePath();x.fill();}
    x.fillStyle='rgba(190,240,255,.28)';x.beginPath();x.arc(0,-2,15,Math.PI,0);x.fill();
    x.save();x.beginPath();x.arc(0,-2,14,Math.PI,0);x.lineTo(14,4);x.lineTo(-14,4);x.clip();face(x,0,-4,1,mood,'#2b2a4a','#ff5d6c');x.restore();
    x.strokeStyle='rgba(230,255,255,.9)';x.lineWidth=2;x.beginPath();x.arc(0,-2,15,Math.PI,0);x.stroke();
    x.globalAlpha=.6;x.fillStyle='#fff';x.beginPath();x.ellipse(-8,-12,3.6,1.8,-.6,0,TAU);x.fill();x.globalAlpha=1;
    const g=x.createLinearGradient(0,-4,0,14);g.addColorStop(0,'#8ff8e4');g.addColorStop(.5,'#35d9bb');g.addColorStop(1,'#1c9c93');
    x.fillStyle=g;x.beginPath();x.ellipse(0,4,29,10.5,0,0,TAU);x.fill();
    x.fillStyle='#fff';for(const [dx,dy,r] of [[-18,3,2.6],[-7,7,2.2],[6,7,2.6],[18,3,2.2],[0,1,1.8]]){x.beginPath();x.arc(dx,dy,r,0,TAU);x.fill();}
    for(let i=0;i<5;i++){const on=Math.floor(t*6+i)%2===0;x.fillStyle=on?'#ffe066':'#fff3d9';x.beginPath();x.arc(-20+i*10,11.5+(i===0||i===4?-2:0),1.8,0,TAU);x.fill();}
    x.strokeStyle='#cfd6ff';x.lineWidth=1.6;x.beginPath();x.moveTo(0,-17);x.lineTo(0,-24);x.stroke();
    x.fillStyle=Math.floor(t*3)%2?'#ff5d6c':'#ffcb47';x.beginPath();x.arc(0,-25.5,3,0,TAU);x.fill();
  }
  x.restore();}
function drawDrone(x,type,px,py,s,t){x.save();x.translate(px,py);x.scale(s,s);
  if(type==='guoguo'){x.fillStyle='#ffb36b';x.beginPath();x.arc(0,0,9,0,TAU);x.fill();x.strokeStyle='#e8664a';x.lineWidth=1.5;x.stroke();x.fillStyle='#4fcf6a';x.beginPath();x.ellipse(4,-9,4.6,2,-.5,0,TAU);x.fill();
    x.fillStyle='#2b2466';x.beginPath();x.arc(-3,0,1.6,0,TAU);x.arc(3,0,1.6,0,TAU);x.fill();}
  else{x.fillStyle='#8ff8e4';x.beginPath();x.ellipse(0,1,12,5,0,0,TAU);x.fill();x.fillStyle='rgba(220,255,255,.6)';x.beginPath();x.arc(0,-1,6,Math.PI,0);x.fill();x.fillStyle='#fff';x.beginPath();x.arc(-5,2,1.4,0,TAU);x.arc(5,2,1.4,0,TAU);x.fill();}
  x.restore();}
// ---- 班主任 ----
function drawBoss(x,b,s,t){x.save();x.translate(b.x,b.y);x.scale(s,s);const angry=b.mood||0;
  const pulse=.5+.5*Math.sin(t*6);const au=x.createRadialGradient(0,0,20,0,0,70);au.addColorStop(0,`rgba(255,80,100,${.18+.12*pulse})`);au.addColorStop(1,'rgba(255,80,100,0)');x.fillStyle=au;x.beginPath();x.arc(0,0,70,0,TAU);x.fill();
  x.fillStyle='#6b4bb8';x.beginPath();x.ellipse(0,40,34,18,0,Math.PI,TAU);x.fill();x.fillStyle='#fff3d9';x.beginPath();x.moveTo(-9,24);x.lineTo(0,34);x.lineTo(9,24);x.fill();
  x.fillStyle='#3b2a4a';x.beginPath();x.arc(0,-33,12,0,TAU);x.fill();x.beginPath();x.ellipse(0,-10,33,30,0,Math.PI,TAU);x.fill();
  x.fillStyle='#ffd9bf';x.beginPath();x.arc(0,0,28,0,TAU);x.fill();
  x.fillStyle='#3b2a4a';x.beginPath();x.moveTo(-28,-4);x.quadraticCurveTo(-20,-26,0,-24);x.quadraticCurveTo(14,-26,28,-4);x.quadraticCurveTo(20,-16,6,-15);x.quadraticCurveTo(-14,-16,-28,-4);x.fill();
  x.fillStyle='#ff8b8b';x.globalAlpha=.6+.3*pulse;x.beginPath();x.arc(-17,10,5,0,TAU);x.arc(17,10,5,0,TAU);x.fill();x.globalAlpha=1;
  x.strokeStyle='#2d2d5a';x.lineWidth=2.6;x.beginPath();x.arc(-10,1,8,0,TAU);x.moveTo(18,1);x.arc(10,1,8,0,TAU);x.moveTo(-2,1);x.lineTo(2,1);x.stroke();
  x.fillStyle='#2d2d5a';x.beginPath();x.arc(-10,2,2.3,0,TAU);x.arc(10,2,2.3,0,TAU);x.fill();
  x.lineWidth=3.4;x.lineCap='round';x.beginPath();x.moveTo(-18,-10+angry*1);x.lineTo(-4,-5);x.moveTo(18,-10+angry*1);x.lineTo(4,-5);x.stroke();
  const mo=4+3*Math.abs(Math.sin(t*(b.shout?18:4)));x.fillStyle='#8a1f3b';x.beginPath();x.ellipse(0,16,7,mo,0,0,TAU);x.fill();x.fillStyle='#ff7d95';x.beginPath();x.ellipse(0,16+mo*.5,4,mo*.35,0,0,TAU);x.fill();
  x.save();x.translate(30,-22);x.scale(1+.15*pulse,1+.15*pulse);x.strokeStyle='#ff3d57';x.lineWidth=3;for(let i=0;i<4;i++){x.rotate(Math.PI/2);x.beginPath();x.moveTo(3,3);x.quadraticCurveTo(8,3,9,8);x.stroke();}x.restore();
  if(!b.penOut){x.save();x.translate(-34,24);x.rotate(-.7+Math.sin(t*3)*.15);x.fillStyle='#e2364b';rr(x,-3,-22,6,30,2);x.fill();x.fillStyle='#fff3d9';x.fillRect(-3,-16,6,3);x.fillStyle='#2d2d5a';x.beginPath();x.moveTo(-3,8);x.lineTo(0,15);x.lineTo(3,8);x.fill();x.restore();}
  x.restore();}
function drawPen(x,px,py,ang,s){x.save();x.translate(px,py);x.rotate(ang);x.scale(s,s);x.fillStyle='#e2364b';rr(x,-5,-44,10,48,3);x.fill();x.fillStyle='#fff3d9';x.fillRect(-5,-34,10,5);x.fillStyle='#2d2d5a';x.beginPath();x.moveTo(-5,4);x.lineTo(0,16);x.lineTo(5,4);x.fill();x.restore();}

// ================= 特效池（粒子 / 飘字 / 金币飞向计分板）=================
const FONT='"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
const PMAX=700,PT=[];for(let i=0;i<PMAX;i++)PT.push({on:false,x:0,y:0,vx:0,vy:0,life:0,max:1,size:2,col:'#fff',type:0,g:0,drag:0,rot:0,vr:0});
let pHead=0;
function emit(x,y,n,o){for(let k=0;k<n;k++){let p=null;for(let j=0;j<PMAX;j++){const q=PT[(pHead+j)%PMAX];if(!q.on){p=q;pHead=(pHead+j+1)%PMAX;break;}}if(!p){p=PT[pHead];pHead=(pHead+1)%PMAX;}
  const a=o.ang!==undefined?o.ang+rand(-(o.spread||0),o.spread||0):rand(0,TAU),s=rand(o.spd[0],o.spd[1])*K;
  p.on=true;p.x=x+(o.jit?rand(-o.jit,o.jit):0);p.y=y+(o.jit?rand(-o.jit,o.jit):0);p.vx=Math.cos(a)*s+(o.vx||0);p.vy=Math.sin(a)*s+(o.vy||0);p.max=p.life=rand(o.life[0],o.life[1]);
  p.size=rand(o.size[0],o.size[1])*K;p.col=o.cols?o.cols[(Math.random()*o.cols.length)|0]:o.col;p.type=o.type||0;p.g=(o.g||0)*K;p.drag=o.drag||0;p.rot=rand(0,TAU);p.vr=rand(-8,8);}}
function updParticles(dt){for(const p of PT){if(!p.on)continue;p.life-=dt;if(p.life<=0){p.on=false;continue;}p.vy+=p.g*dt;if(p.drag){const d=Math.exp(-p.drag*dt);p.vx*=d;p.vy*=d;}p.x+=p.vx*dt;p.y+=p.vy*dt;p.rot+=p.vr*dt;}}
function drawParticles(){for(const p of PT){if(!p.on)continue;const a=p.life/p.max;cx.globalAlpha=a<.4?a/.4:1;cx.fillStyle=p.col;cx.strokeStyle=p.col;
  switch(p.type){
  case 0:{const s=p.size*(.4+.6*a);cx.fillRect(p.x-s/2,p.y-s/2,s,s);break;}
  case 1:{cx.lineWidth=p.size;cx.beginPath();cx.moveTo(p.x,p.y);cx.lineTo(p.x-p.vx*.05,p.y-p.vy*.05);cx.stroke();break;}
  case 2:{cx.save();cx.translate(p.x,p.y);cx.rotate(p.rot);cx.fillRect(-p.size,-p.size*.65,p.size*2,p.size*1.3);cx.restore();break;}
  case 3:{const s=p.size*(.5+.5*Math.sin(a*Math.PI));cx.beginPath();cx.moveTo(p.x,p.y-s);cx.lineTo(p.x+s*.28,p.y-s*.28);cx.lineTo(p.x+s,p.y);cx.lineTo(p.x+s*.28,p.y+s*.28);cx.lineTo(p.x,p.y+s);cx.lineTo(p.x-s*.28,p.y+s*.28);cx.lineTo(p.x-s,p.y);cx.lineTo(p.x-s*.28,p.y-s*.28);cx.closePath();cx.fill();break;}
  case 4:{cx.lineWidth=2.5*K*a;cx.beginPath();cx.arc(p.x,p.y,p.size*(1+(1-a)*2.2),0,TAU);cx.stroke();break;}}}
  cx.globalAlpha=1;}
const TX=[];for(let i=0;i<28;i++)TX.push({on:false});
function ftext(text,x,y,o){o=o||{};let t=TX.find(q=>!q.on);if(!t){t=TX[0];}const fs=Math.max((o.size||16)*K,(o.size||16)*.85);for(const q of TX)if(q.on&&q!==t&&q.t<.35&&Math.abs(q.x-x)<90*K&&Math.abs(q.y-y)<fs*1.1)y=q.y-fs*1.15;Object.assign(t,{on:true,text,x,y,t:0,max:o.life||.8,size:Math.max((o.size||16)*K,(o.size||16)*.85),col:o.col||'#fff',rise:(o.rise===undefined?42:o.rise)*K,big:!!o.big});}
function updTexts(dt){for(const t of TX)if(t.on){t.t+=dt;if(t.t>=t.max)t.on=false;}}
function drawTexts(){cx.textAlign='center';cx.textBaseline='middle';cx.lineJoin='round';
  for(const t of TX){if(!t.on)continue;const k=t.t/t.max,s=t.t<.18?easeOutBack(t.t/.18):1,y=t.y-t.rise*easeOutCubic(k);
    cx.globalAlpha=k>.7?(1-k)/.3:1;cx.save();cx.translate(t.x,y);cx.scale(s,s);cx.font=`900 ${t.size}px ${FONT}`;
    cx.lineWidth=t.size*.22;cx.strokeStyle='#241656';cx.strokeText(t.text,0,0);cx.fillStyle=t.col;cx.fillText(t.text,0,0);cx.restore();}
  cx.globalAlpha=1;}
const FLY=[];
function flyCoin(x,y){if(FLY.length>26)return false;FLY.push({x0:x,y0:y,t:0,dur:rand(.42,.55)});return true;}
let scorePopAt=0;
function popScore(){const n=performance.now();if(n-scorePopAt<70)return;scorePopAt=n;const el=$('scoreBox');if(el.animate)el.animate([{transform:'scale(1.18)'},{transform:'scale(1)'}],{duration:200,easing:'cubic-bezier(.3,1.6,.5,1)'});}
function updFly(dt){for(let i=FLY.length-1;i>=0;i--){const f=FLY[i];f.t+=dt;if(f.t>=f.dur){FLY.splice(i,1);popScore();}}}
function drawFly(){if(!SPR.coin.length)return;for(const f of FLY){const p=easeInOut(Math.min(1,f.t/f.dur));const x=lerp(f.x0,scoreTarget.x,p),y=lerp(f.y0,scoreTarget.y,p)-Math.sin(p*Math.PI)*60*K;
  blit(SPR.coin[((vt*20+f.x0)|0)%COIN_FR],x,y,lerp(1,.6,p));}}

// ================= 镜头：创伤值震动 + 卡帧 =================
let trauma=0,shT=0,flash=0,flashCol='255,80,110';
const shakeMul=()=>SV.shake===2?1:SV.shake===1?.45:0;
function addTrauma(a){trauma=Math.min(1,trauma+a*shakeMul());}
function doFlash(a,col){if(!SV.flash)a*=.3;flash=Math.max(flash,a);flashCol=col||'255,80,110';}

// ================= 星空：三层视差 + 远景行星 =================
const STARS=[];let planetY=0,moonY=0,shoot=null;
function layoutStars(){STARS.length=0;const area=W*H;const L=[{n:area/2600,sp:10,sz:1.1,a:.55,col:'#bfc4ff'},{n:area/7000,sp:32,sz:1.8,a:.8,col:'#e6e3ff'},{n:area/22000,sp:85,sz:2.6,a:1,col:'#fff6dc'}];
  for(const l of L){const n=Math.max(12,Math.min(600,l.n|0)),xs=new Float32Array(n),ys=new Float32Array(n),tw=new Float32Array(n);for(let i=0;i<n;i++){xs[i]=Math.random()*W;ys[i]=Math.random()*H;tw[i]=Math.random()*TAU;}STARS.push(Object.assign({xs,ys,tw},l));}}
let starSpeed=1,starTarget=1;
function updStars(dt){starSpeed=lerp(starSpeed,starTarget,1-Math.exp(-3*dt));for(const l of STARS){const v=l.sp*K*starSpeed*dt;for(let i=0;i<l.ys.length;i++){l.ys[i]+=v;if(l.ys[i]>H+4){l.ys[i]=-4;l.xs[i]=Math.random()*W;}}}
  planetY+=3*K*starSpeed*dt;moonY+=6*K*starSpeed*dt;
  if(!shoot&&Math.random()<dt*.12)shoot={x:rand(W*.2,W),y:rand(0,H*.4),t:0};if(shoot){shoot.t+=dt;if(shoot.t>.8)shoot=null;}}
function drawSky(){cx.drawImage(SPR.bg,0,0,W,H);
  const pr=SPR.planetR,py=((H*.72+planetY)%(H+pr*3.4))-pr*1.6;cx.globalAlpha=.6;cx.drawImage(SPR.planet,W*.86-SPR.planet.width/2,py-SPR.planet.height/2);
  const my=((H*.16+moonY)%(H+200))-60;cx.globalAlpha=.5;cx.drawImage(SPR.moon,W*.12-SPR.moon.width/2,my-SPR.moon.height/2);cx.globalAlpha=1;
  const streak=starSpeed>1.8;
  for(const l of STARS){cx.fillStyle=l.col;cx.strokeStyle=l.col;const s=l.sz*Math.max(1,K*.9);
    if(streak&&l.sp>30){cx.globalAlpha=l.a*.8;cx.lineWidth=s*.8;cx.beginPath();const len=l.sp*K*starSpeed*.06;for(let i=0;i<l.ys.length;i++){cx.moveTo(l.xs[i],l.ys[i]);cx.lineTo(l.xs[i],l.ys[i]-len);}cx.stroke();}
    else{for(let i=0;i<l.ys.length;i++){cx.globalAlpha=l.a*(l.sp<20?.6+.4*Math.sin(vt*2+l.tw[i]):1);cx.fillRect(l.xs[i],l.ys[i],s,s);}}}
  cx.globalAlpha=1;
  if(shoot){const k=shoot.t/.8,x=shoot.x-k*W*.35,y=shoot.y+k*H*.18;cx.strokeStyle=`rgba(255,246,220,${1-k})`;cx.lineWidth=2;cx.beginPath();cx.moveTo(x,y);cx.lineTo(x+60,y-30);cx.stroke();}}

// ================= 游戏规则 =================
const DUR=60;
const SHIPS={guoguo:{name:'果果号',every:10,skill:'僚机',col:'#ff9152'},diandian:{name:'点点号',every:5,skill:'激光',col:'#35d9bb'}};
// 节奏（张弛曲线）：热身 → 航道 → 金币雨（喘息+奖励）→ 作业风暴 → BOSS
const PHASES=[{t:0,id:'warm',name:'热身航段'},{t:9,id:'belt',name:'金币航道'},{t:22,id:'rain',name:'金币雨'},{t:28,id:'storm',name:'作业风暴'},{t:45,id:'boss',name:'班主任来了'}];
const POW_SCHED=[{t:11,type:'magnet'},{t:24,type:'heart'},{t:31.5,type:'shield'},{t:39,type:'double'},{t:50,type:'magnet'},{t:55.5,type:'heart'}];
const MEDALS=[{min:900,name:'金',c:['#ffd75e','#e89a12','#a85a00']},{min:500,name:'银',c:['#eef1ff','#aab3d6','#6d77a0']},{min:200,name:'铜',c:['#ffc79b','#d67c45','#8a4a20']}];
let mode='title',paused=false,overT=0,vt=0,G=null,overCount=null;
const keys=new Set();let drag=null;
function phaseIdx(t){let i=0;for(let k=0;k<PHASES.length;k++)if(t>=PHASES[k].t)i=k;return i;}
const dens=()=>clamp(W/(H*.62),.85,1.7);
const multFor=c=>c>=40?4:c>=20?3:c>=8?2:1;
function bounds(){const r=G?G.r:20;return{x0:safe.l+r+4,x1:W-safe.r-r-4,y0:Math.max(playTop+r+14,playTop+(H-playTop)*.24),y1:H-safe.b-r-12};}
function newRun(ship){const r=17*K;return{ship,t:0,score:0,coins:0,lives:3,combo:0,comboT:0,maxCombo:0,sets:0,burned:0,blocked:0,
  x:W/2,y:H*.76,tx:W/2,ty:H*.76,px:W/2,vx:0,r,inv:0,sx:1,sy:1,svx:0,svy:0,mood:'idle',moodT:0,spin:0,
  cs:[],bs:[],ps:[],ink:[],drones:[],lasers:[],laserQ:0,laserCd:0,skill:0,
  magnet:0,double:0,shield:false,coinClock:.5,bookClock:1.8,patClock:.9,phase:0,powIdx:0,
  boss:null,ending:null,endT:0,bonus:0,setId:1,sets_:{},lastSec:DUR,hitStop:0,banner:null,trail:0};}

function spawnCoin(x,y,vy,set,kind){const gem=kind==='gem';G.cs.push({x,y,vx:0,vy,r:gem?SPR.gemR*.95:SPR.coinR*1.05,kind:gem?'gem':'coin',val:gem?5:1,ph:rand(0,TAU),spin:rand(7,10),age:0,set:set||0,mag:false,dead:false});}
function coinVy(){return H/3.3*(G.phase===2?1.25:1);}
function spawnPattern(){const r=SPR.coinR,gap=r*2.5,vy=coinVy(),sid=G.setId++,b=bounds();const kinds=['line','arc','zig','v','ring'];const kind=kinds[(Math.random()*kinds.length)|0];
  const span=kind==='line'?0:kind==='zig'?gap*4.4:gap*7;const x0=rand(b.x0+span/2,Math.max(b.x0+span/2,b.x1-span/2));let n=0;const top=-r*2;
  if(kind==='line'){n=6;for(let i=0;i<n;i++)spawnCoin(x0,top-i*gap,vy,sid);}
  else if(kind==='arc'){n=7;for(let i=0;i<n;i++){const d=i-3;spawnCoin(x0+d*gap,top-(9-d*d)*gap*.32,vy,sid);}}
  else if(kind==='zig'){n=8;for(let i=0;i<n;i++)spawnCoin(x0+Math.sin(i*.95)*gap*2.2,top-i*gap,vy,sid);}
  else if(kind==='v'){n=7;for(let i=0;i<n;i++){const d=i-3;spawnCoin(x0+d*gap,top-Math.abs(d)*gap,vy,sid);}}
  else{n=8;for(let i=0;i<n;i++){const a=i/n*TAU;spawnCoin(x0+Math.cos(a)*gap*1.7,top-gap*1.7+Math.sin(a)*gap*1.7,vy,sid);}spawnCoin(x0,top-gap*1.7,vy,0,'gem');}
  G.sets_[sid]={n,got:0,miss:false};}
function spawnBook(){const b=bounds(),ph=G.phase,big=ph>=3&&Math.random()<.13,r=SPR.bookR*(big?1.5:1)*.74;
  const spd=H/3.1*(ph===0?.8:ph===1?.92:1.04)*rand(.9,1.15)*(big?.78:1);
  const wob=ph>=3&&!big&&Math.random()<.35;G.bs.push({x:rand(b.x0,b.x1),y:-r*2,vx:0,vy:spd,r,big,col:(Math.random()*4)|0,rot:rand(-.4,.4),vr:rand(-1,1),wob,wa:rand(28,64)*K,wf:rand(1.6,2.6),wp:rand(0,TAU),x0:0,age:0,boss:false,dead:false});
  const bk=G.bs[G.bs.length-1];bk.x0=bk.x;}
function spawnPow(type){if(type==='heart'&&G.lives>=3)type=G.shield?'double':'shield';const b=bounds();G.ps.push({x:rand(b.x0+30*K,b.x1-30*K),y:-SPR.powR*2,vy:H/4.6,type,r:SPR.powR,age:0,x0:0,dead:false});G.ps[G.ps.length-1].x0=G.ps[G.ps.length-1].x;}
function dronePos(i,n){const a=G.t*2.6+i*TAU/n,R=54*K;return[G.x+Math.cos(a)*R,G.y+Math.sin(a)*R];}

function setBanner(text,sub,col){G.banner={text,sub:sub||'',t:0,dur:1.7,col:col||'#ffe08a'};sfx('banner');}
function setMood(m,t){G.mood=m;G.moodT=t;}
function collect(c){if(c.dead)return;c.dead=true;G.coins++;G.combo++;G.comboT=1.6;if(G.combo>G.maxCombo)G.maxCombo=G.combo;
  const m=multFor(G.combo),pts=c.val*m*(G.double>0?2:1);G.score+=pts;
  if(c.kind==='gem'){sfx('gem');emit(c.x,c.y,14,{type:3,cols:['#fff0a0','#ff9ad5','#b9a4ff'],spd:[60,220],life:[.4,.8],size:[4,8],drag:3});addTrauma(.12);ftext('+'+pts,c.x,c.y-10,{size:24,col:'#ffb3e6'});}
  else{sfx('coin',G.combo);emit(c.x,c.y,5,{type:3,col:'#fff1a8',spd:[40,150],life:[.25,.5],size:[3,6],drag:4});if(pts>1)ftext('+'+pts,c.x,c.y-8,{size:15,col:m>=3?'#ff9ad5':'#ffe08a',life:.6,rise:34});}
  emit(c.x,c.y,1,{type:4,col:c.kind==='gem'?'#ffb3e6':'#ffe08a',spd:[0,0],life:[.3,.3],size:[c.r*.8,c.r*.8]});
  flyCoin(c.x,c.y);G.svy-=2.2;G.svx+=1.6;setMood('happy',.35);
  if(G.combo%10===0){const big=G.combo>=20;ftext(`连击 ${G.combo}！`,G.x,G.y-50*K,{size:big?30:24,col:big?'#ff9ad5':'#fff3d9',life:1,big:true});sfx('combo',Math.min(6,G.combo/10));addTrauma(.1);
    emit(G.x,G.y,12,{type:3,cols:['#ffe08a','#ff9ad5','#8ff8e4'],spd:[120,260],life:[.4,.7],size:[4,7],drag:3});}
  else if(G.combo===8||G.combo===20||G.combo===40)ftext(`倍率 ×${m}`,G.x,G.y-46*K,{size:22,col:'#8ff8e4',life:.9});
  if(c.set){const s=G.sets_[c.set];if(s){s.got++;if(s.got>=s.n&&!s.miss){const bonus=10*(G.double>0?2:1);G.score+=bonus;G.sets++;sfx('set');ftext(`整排收齐 +${bonus}`,c.x,c.y-30*K,{size:20,col:'#8ff8e4',life:1});delete G.sets_[c.set];}}}
  const sh=SHIPS[G.ship],earned=Math.floor(G.coins/sh.every);
  while(G.skill<earned){G.skill++;if(G.ship==='guoguo'){if(G.drones.length<4){G.drones.push({id:G.skill});sfx('drone');ftext('僚机加入！',G.x,G.y-60*K,{size:20,col:'#ffc08a'});emit(G.x,G.y,14,{type:3,col:'#ffc08a',spd:[80,200],life:[.3,.6],size:[3,6],drag:3});}
      else{G.score+=10;ftext('僚机满编 +10',G.x,G.y-60*K,{size:18,col:'#ffc08a'});}}
    else G.laserQ++;}
  hudScore();hudCombo();hudSkill();}
function burnBook(b,how){if(b.dead)return;b.dead=true;G.burned++;G.score+=2;
  emit(b.x,b.y,12,{type:2,cols:['#fff3d9','#ffffff',BOOKCOL[b.col][0]],spd:[60,220],life:[.5,.9],size:[3,5],g:300,drag:1.5});
  emit(b.x,b.y,8,{type:0,cols:how==='laser'?['#8ff8e4','#e6fffb']:['#ffc08a','#fff3d9'],spd:[40,160],life:[.3,.5],size:[3,5],drag:3});
  ftext('+2',b.x,b.y,{size:15,col:'#8ff8e4',life:.6});sfx('burn');addTrauma(.08);hudScore();}
function hurt(cause){if(G.inv>0||G.ending)return false;G.lastHit={t:+G.t.toFixed(2),cause:cause||'?'};
  if(G.shield){G.shield=false;G.inv=1;sfx('shieldBreak');addTrauma(.3);G.hitStop=.06;emit(G.x,G.y,22,{type:1,cols:['#bfe9ff','#5fc6ff','#fff'],spd:[160,360],life:[.25,.5],size:[2,3],drag:2});ftext('护盾挡住了！',G.x,G.y-52*K,{size:20,col:'#bfe9ff'});hudPowers();return true;}
  G.lives--;G.inv=1.8;const lost=G.combo>=5;G.combo=0;G.comboT=0;G.hitStop=.13;addTrauma(.62);doFlash(.55);sfx('hit');setMood('ouch',.9);G.svx+=6;G.svy-=5;
  emit(G.x,G.y,16,{type:2,cols:['#fff3d9','#ffd0d6','#ff5d6c'],spd:[100,300],life:[.5,1],size:[3,5],g:260,drag:1.2});
  emit(G.x,G.y,10,{type:1,col:'#ff8c98',spd:[200,380],life:[.2,.35],size:[2,3],drag:2});
  ftext(lost?'连击断了！':'哎呀！',G.x,G.y-54*K,{size:22,col:'#ffb3ba'});
  try{navigator.vibrate&&navigator.vibrate(70);}catch(e){}
  hudLives(true);hudCombo();
  if(G.lives<=0){G.ending='lost';G.endT=1.4;sfx('lose');setBanner('作业本拦住了去路','',"#ffb3ba");}
  return true;}
function activatePow(type){G.score+=5;sfx(type==='heart'?'heart':'power');const col=POW[type].c;
  emit(G.x,G.y,18,{type:3,cols:[col,'#ffffff'],spd:[90,260],life:[.4,.7],size:[4,8],drag:3});emit(G.x,G.y,1,{type:4,col,spd:[0,0],life:[.4,.4],size:[G.r,G.r]});
  if(type==='magnet'){G.magnet=7;ftext('磁铁！金币都过来',G.x,G.y-56*K,{size:20,col:'#ffb3ba'});}
  else if(type==='double'){G.double=7;ftext('双倍得分 ×2',G.x,G.y-56*K,{size:20,col:'#ffe08a'});}
  else if(type==='shield'){G.shield=true;ftext('护盾展开',G.x,G.y-56*K,{size:20,col:'#bfe9ff'});}
  else{G.lives=Math.min(3,G.lives+1);ftext('爱心 +1',G.x,G.y-56*K,{size:20,col:'#ffb3d6'});hudLives();}
  G.svy-=3;hudPowers();hudScore();}

function bossStep(dt){if(G.t<45&&!G.boss)return;const S=K*1.1;
  if(!G.boss){G.boss={x:W/2,y:-90*S,enter:0,phase:'enter',clock:1.4,attack:0,tx:0,ty:0,prog:0,mood:0,shout:false,penOut:false,leave:0};sfx('boss');addTrauma(.4);G.hitStop=.07;
    setBanner('⚠ 生气的班主任来了！','看准红圈，坚持最后 15 秒',"#ffb3ba");hudPhase();musicSync();}
  const b=G.boss,baseY=playTop+66*S;
  if(b.leave>0){b.leave+=dt;b.y-=dt*(260+b.leave*600)*K;return;}
  b.enter=Math.min(1,b.enter+dt/1.2);b.x=W/2+Math.sin((G.t-45)*.7)*Math.min(W*.3,W/2-60*S);b.y=lerp(-90*S,baseY,easeOutBack(b.enter));
  b.shout=b.phase==='throwWarn'||b.phase==='penWarn';b.clock-=dt;
  if(b.phase==='enter'&&b.clock<=0){b.phase='idle';b.clock=.5;}
  else if(b.phase==='idle'&&b.clock<=0){b.phase=b.attack%2===0?'throwWarn':'penWarn';b.clock=b.phase==='penWarn'?1.0:.9;b.tx=G.x;b.ty=G.y;sfx('warn');}
  else if(b.phase==='throwWarn'&&b.clock<=0){const ang=Math.atan2(b.ty-b.y,b.tx-b.x),sp=H*.62;
    for(const off of[-.3,0,.3]){const a=ang+off,r=SPR.bookR*.74;G.bs.push({x:b.x,y:b.y+26*S,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r,big:false,col:(Math.random()*4)|0,rot:a-Math.PI/2,vr:rand(-3,3),wob:false,wa:0,wf:0,wp:0,x0:0,age:0,boss:true,dead:false});}
    b.phase='idle';b.clock=1.35;b.attack++;sfx('throw');addTrauma(.12);}
  else if(b.phase==='penWarn'&&b.clock<=0){b.phase='pen';b.clock=.3;b.penOut=true;b.sx=b.x-34*S;b.sy=b.y+24*S;}
  else if(b.phase==='pen'){b.prog=1-Math.max(0,b.clock)/.3;
    if(b.clock<=0){b.phase='recover';b.clock=.5;const R=46*K;sfx('stamp');addTrauma(.45);G.ink.push({x:b.tx,y:b.ty,t:0,R});
      emit(b.tx,b.ty,16,{type:0,cols:['#e2364b','#ff5d6c'],spd:[80,260],life:[.3,.6],size:[3,6],drag:3});
      let saved=false;for(let i=0;i<G.drones.length;i++){const[dx,dy]=dronePos(i,G.drones.length);if(Math.hypot(dx-b.tx,dy-b.ty)<R+8*K){G.drones.splice(i,1);saved=true;sfx('droneLost');emit(dx,dy,14,{type:2,col:'#ffc08a',spd:[80,220],life:[.4,.7],size:[3,4],g:200});ftext('僚机挡住了！',dx,dy-20*K,{size:18,col:'#ffc08a'});break;}}
      if(!saved&&Math.hypot(G.x-b.tx,G.y-b.ty)<R+G.r*.4)hurt('pen');}}
  else if(b.phase==='recover'&&b.clock<=0){b.penOut=false;b.phase='idle';b.clock=.95;b.attack++;}}

function step(dt){vt+=dt;
  updStars(dt);updParticles(dt);updTexts(dt);updFly(dt);
  trauma=Math.max(0,trauma-1.3*dt);shT+=dt;flash=Math.max(0,flash-dt*2.2);
  if(mode==='over'){overT+=dt;if(overCount){overCount.t+=dt;const k=Math.min(1,overCount.t/1.1);$('overScore').textContent=Math.round(overCount.to*easeOutCubic(k));if(k>=1)overCount=null;}musicSync();return;}
  if(mode!=='play'){starTarget=.45;return;}
  if(paused){starTarget=0;return;}
  if(G.hitStop>0){G.hitStop-=dt;return;}
  const sdt=G.ending==='lost'?dt*.35:dt;
  // ---- 输入：键盘推动目标点，指针为相对拖动；飞艇平滑追随目标 ----
  const b=bounds(),sp=clamp(Math.max(W,H)*.62,380,900);
  if(!G.ending||G.ending==='won'){let dx=0,dy=0;if(keys.has('arrowleft')||keys.has('a'))dx--;if(keys.has('arrowright')||keys.has('d'))dx++;if(keys.has('arrowup')||keys.has('w'))dy--;if(keys.has('arrowdown')||keys.has('s'))dy++;
    if(dx||dy){const n=Math.hypot(dx,dy);G.tx+=dx/n*sp*dt;G.ty+=dy/n*sp*dt;}}
  G.tx=clamp(G.tx,b.x0,b.x1);G.ty=clamp(G.ty,b.y0,b.y1);
  const f=1-Math.exp(-30*dt);G.px=G.x;G.x+=(G.tx-G.x)*f;G.y+=(G.ty-G.y)*f;G.vx=lerp(G.vx,(G.x-G.px)/Math.max(dt,1e-4),.3);
  // 弹簧形变（挤压/拉伸回弹）
  G.svx+=(-(G.sx-1)*320-G.svx*16)*dt;G.svy+=(-(G.sy-1)*320-G.svy*16)*dt;G.svx=clamp(G.svx,-9,9);G.svy=clamp(G.svy,-9,9);G.sx+=G.svx*dt;G.sy+=G.svy*dt;
  if(G.moodT>0){G.moodT-=dt;if(G.moodT<=0)G.mood='idle';}
  G.trail-=dt;if(G.trail<=0){G.trail=.016;emit(G.x+rand(-4,4)*K,G.y+20*K*1.1,1,{type:0,col:G.ship==='guoguo'?'#ffb13b':'#5ff0d4',spd:[10,30],ang:Math.PI/2,spread:.4,vy:120*K,life:[.25,.4],size:[3,5]});}
  if(G.ending){G.endT-=dt;if(G.ending==='lost')G.spin+=dt*8;
    if(G.ending==='won'){for(const c of G.cs){const dx=G.x-c.x,dy=G.y-c.y,d=Math.hypot(dx,dy)||1;c.x+=dx/d*900*K*dt;c.y+=dy/d*900*K*dt;if(d<G.r+c.r)collect(c);}if(G.boss&&G.boss.leave===0)G.boss.leave=.01;if(G.boss)bossStep(dt);}
    compact(G.cs);if(G.endT<=0)finish();return;}
  G.t+=sdt;G.inv=Math.max(0,G.inv-sdt);
  if(G.magnet>0){G.magnet-=sdt;if(G.magnet<=0){G.magnet=0;hudPowers();}}
  if(G.double>0){G.double-=sdt;if(G.double<=0){G.double=0;hudPowers();}}
  if(G.comboT>0){G.comboT-=sdt;if(G.comboT<=0){G.combo=0;hudCombo();}}
  const sec=Math.ceil(Math.max(0,DUR-G.t));if(sec!==G.lastSec){G.lastSec=sec;hudTime();hudPowers();if(sec<=5&&sec>0)sfx('tick');}
  // ---- 阶段切换 ----
  const pi=phaseIdx(G.t);if(pi!==G.phase){G.phase=pi;hudPhase();const P=PHASES[pi];
    if(P.id==='belt')setBanner('金币航道','金币排成队，整排收齐有奖励');
    else if(P.id==='rain'){setBanner('金币雨！','没有作业本，放心收！','#8ff8e4');sfx('rain');musicHot=1;for(const bk of G.bs)if(!bk.boss)burnBook(bk,'laser');}
    else if(P.id==='storm'){setBanner('作业风暴来袭','作业本会左右飘了','#ffb3ba');musicHot=0;}}
  starTarget=G.phase===2?3.2:G.boss?1.4:1;
  // ---- 生成 ----
  const D=dens(),pt=(G.t-PHASES[G.phase].t)/((PHASES[G.phase+1]?PHASES[G.phase+1].t:DUR)-PHASES[G.phase].t);
  G.coinClock-=sdt;G.bookClock-=sdt;G.patClock-=sdt;
  if(G.phase===2){if(G.coinClock<=0){G.coinClock+=.075/D;spawnCoin(rand(b.x0,b.x1),-SPR.coinR*2,coinVy()*rand(.9,1.15),0,Math.random()<.08?'gem':'coin');}}
  else{if(G.coinClock<=0){G.coinClock+=.62/D;spawnCoin(rand(b.x0,b.x1),-SPR.coinR*2,coinVy()*rand(.9,1.05),0,Math.random()<.04?'gem':'coin');}
    if(G.patClock<=0){G.patClock+=(G.phase===0?3.0:G.phase===4?3.2:2.5)/Math.sqrt(D);spawnPattern();}
    if(G.bookClock<=0){const base=[[1.6,1.25],[1.05,.8],[1,1],[.72,.5],[1.3,1.15]][G.phase];G.bookClock+=lerp(base[0],base[1],clamp(pt,0,1))/D;spawnBook();}}
  if(G.powIdx<POW_SCHED.length&&G.t>=POW_SCHED[G.powIdx].t){spawnPow(POW_SCHED[G.powIdx].type);G.powIdx++;}
  bossStep(sdt);
  // ---- 移动 ----
  const magR=(G.magnet>0?250:64)*K;
  for(const c of G.cs){c.age+=sdt;const dx=G.x-c.x,dy=G.y-c.y,d=Math.hypot(dx,dy);
    if(d<magR&&c.y>playTop-20){c.mag=true;}
    if(c.mag&&d>1){const pull=(G.magnet>0?520:380)*K+(1-Math.min(1,d/magR))*700*K;c.x+=dx/d*pull*sdt;c.y+=dy/d*pull*sdt;}else c.y+=c.vy*sdt;}
  for(const bk of G.bs){bk.age+=sdt;if(bk.boss){bk.x+=bk.vx*sdt;bk.y+=bk.vy*sdt;}else{bk.y+=bk.vy*sdt;if(bk.wob)bk.x=bk.x0+Math.sin(bk.age*bk.wf+bk.wp)*bk.wa;}bk.rot+=bk.vr*sdt;}
  for(const p of G.ps){p.age+=sdt;p.y+=p.vy*sdt;p.x=p.x0+Math.sin(p.age*2.2)*26*K;}
  for(const k of G.ink)k.t+=sdt;
  // ---- 技能：激光 ----
  G.laserCd=Math.max(0,G.laserCd-sdt);
  if(G.ship==='diandian'&&G.laserQ>0&&G.laserCd<=0){G.laserQ--;G.laserCd=.42;G.lasers.push({x:G.x,y:G.y-20*K,w:78*K,life:.4,max:.4});sfx('laser');addTrauma(.18);G.svy+=3;
    emit(G.x,G.y-24*K,10,{type:1,col:'#e6fffb',spd:[120,300],ang:-Math.PI/2,spread:.7,life:[.15,.3],size:[2,3]});hudSkill();}
  for(const L of G.lasers){L.life-=sdt;if(L.life<=0)continue;
    for(const c of G.cs)if(!c.dead&&c.y<L.y&&c.y>-10&&Math.abs(c.x-L.x)<L.w/2+c.r*.5)collect(c);
    for(const bk of G.bs)if(!bk.dead&&bk.y<L.y&&bk.y>-10&&Math.abs(bk.x-L.x)<L.w/2+bk.r*.5)burnBook(bk,'laser');}
  // ---- 碰撞 ----
  const nd=G.drones.length,dp=[];for(let i=0;i<nd;i++)dp.push(dronePos(i,nd));const dr=12*K;
  for(const c of G.cs){if(c.dead)continue;if(Math.hypot(c.x-G.x,c.y-G.y)<G.r+c.r){collect(c);continue;}for(const[dx,dy]of dp)if(Math.hypot(c.x-dx,c.y-dy)<dr+c.r){collect(c);break;}}
  for(const bk of G.bs){if(bk.dead)continue;let hitD=-1;for(let i=0;i<dp.length;i++)if(Math.hypot(bk.x-dp[i][0],bk.y-dp[i][1])<dr+bk.r){hitD=i;break;}
    if(hitD>=0){G.drones.splice(hitD,1);dp.splice(hitD,1);G.blocked++;burnBook(bk,'drone');sfx('droneLost');ftext('僚机挡住了！',bk.x,bk.y-20*K,{size:16,col:'#ffc08a'});hudSkill();continue;}
    if(G.inv<=0&&Math.hypot(bk.x-G.x,bk.y-G.y)<G.r*.72+bk.r*.82){bk.dead=true;emit(bk.x,bk.y,8,{type:2,col:'#fff3d9',spd:[60,200],life:[.4,.7],size:[3,5],g:300});hurt(bk.boss?'bossBook':'book@'+Math.round(bk.x)+','+Math.round(bk.y)+' me@'+Math.round(G.x)+','+Math.round(G.y));if(G.ending)break;}}
  for(const p of G.ps){if(!p.dead&&Math.hypot(p.x-G.x,p.y-G.y)<G.r+p.r){p.dead=true;activatePow(p.type);}}
  // ---- 回收 ----
  for(const c of G.cs)if(!c.dead&&(c.y>H+40||c.x<-60||c.x>W+60)){c.dead=true;if(c.set&&G.sets_[c.set])G.sets_[c.set].miss=true;}
  for(const bk of G.bs)if(!bk.dead&&(bk.y>H+60||bk.y<-200||bk.x<-80||bk.x>W+80))bk.dead=true;
  for(const p of G.ps)if(p.y>H+40)p.dead=true;
  compact(G.cs);compact(G.bs);compact(G.ps);
  for(let i=G.lasers.length-1;i>=0;i--)if(G.lasers[i].life<=0)G.lasers.splice(i,1);
  for(let i=G.ink.length-1;i>=0;i--)if(G.ink[i].t>.9)G.ink.splice(i,1);
  if(G.banner){G.banner.t+=dt;if(G.banner.t>G.banner.dur)G.banner=null;}
  if(G.t>=DUR&&!G.ending){G.ending='won';G.endT=2;G.bonus=G.lives*30;sfx('bell');setTimeout(()=>sfx('win'),650);setBanner('下课铃响啦！',`生命奖励 +${G.bonus}`,'#8ff8e4');
    for(const bk of G.bs)burnBook(bk,'laser');G.score-=G.bs.length*2;musicHot=0;musicSync();addTrauma(.25);hudTime();}}
function compact(a){let j=0;for(let i=0;i<a.length;i++)if(!a[i].dead)a[j++]=a[i];a.length=j;}

// ================= 绘制 =================
function drawWorld(){const s=SPR;
  for(const k of G.ink){const a=k.t<.08?k.t/.08:1-Math.max(0,(k.t-.3)/.6),sc=k.t<.08?1.4-.4*k.t/.08:1;cx.save();cx.globalAlpha=Math.max(0,a);cx.translate(k.x,k.y);cx.scale(sc,sc);
    cx.strokeStyle='#e2364b';cx.lineWidth=6*K;cx.lineCap='round';cx.beginPath();cx.arc(0,0,k.R,0,TAU);cx.stroke();cx.beginPath();cx.moveTo(-k.R*.5,-k.R*.5);cx.lineTo(k.R*.5,k.R*.5);cx.moveTo(k.R*.5,-k.R*.5);cx.lineTo(-k.R*.5,k.R*.5);cx.stroke();cx.restore();}
  for(const L of G.lasers){if(L.life<=0)continue;const a=Math.min(1,L.life/L.max*2.2),w=L.w*(.6+.4*Math.min(1,(L.max-L.life)*12));
    const g=cx.createLinearGradient(L.x-w/2,0,L.x+w/2,0);g.addColorStop(0,'rgba(80,190,255,0)');g.addColorStop(.3,'rgba(115,220,255,.55)');g.addColorStop(.5,'rgba(240,255,255,1)');g.addColorStop(.7,'rgba(115,220,255,.55)');g.addColorStop(1,'rgba(80,190,255,0)');
    cx.globalAlpha=a;cx.fillStyle=g;cx.fillRect(L.x-w/2,0,w,L.y);cx.fillStyle='#ffffff';cx.fillRect(L.x-w*.06,0,w*.12,L.y);cx.globalAlpha=1;}
  for(const c of G.cs){if(c.dead)continue;const pop=c.age<.25?Math.max(.01,easeOutBack(c.age/.25)):1;
    if(c.kind==='gem')blit(s.gem,c.x,c.y,pop*(1+.08*Math.sin(vt*8+c.ph)),Math.sin(vt*2+c.ph)*.2);
    else blit(s.coin[((((c.ph+vt*c.spin)/TAU)*COIN_FR)|0)%COIN_FR],c.x,c.y,pop);}
  for(const p of G.ps){if(p.dead)continue;blit(s.pow[p.type],p.x,p.y,1+.07*Math.sin(vt*6),Math.sin(vt*3)*.15);}
  for(const bk of G.bs){if(bk.dead)continue;const img=bk.big?s.bigBook:s.books[bk.col],pop=bk.age<.2?easeOutBack(bk.age/.2):1;blit(img,bk.x,bk.y,pop,bk.rot);}
  const b=G.boss;
  if(b&&(b.phase==='throwWarn'||b.phase==='penWarn')&&!b.leave){const pen=b.phase==='penWarn',R=(pen?46:34)*K,pul=.5+.5*Math.sin(vt*18);
    cx.save();cx.strokeStyle='rgba(255,93,108,.5)';cx.setLineDash([6*K,6*K]);cx.lineWidth=2;cx.beginPath();cx.moveTo(b.x,b.y+26*K);cx.lineTo(b.tx,b.ty);cx.stroke();
    cx.translate(b.tx,b.ty);cx.rotate(vt*2);cx.fillStyle=`rgba(255,93,108,${.12+.12*pul})`;cx.beginPath();cx.arc(0,0,R,0,TAU);cx.fill();cx.strokeStyle='#ff5d6c';cx.lineWidth=3*K;cx.setLineDash([9*K,7*K]);cx.stroke();cx.setLineDash([]);
    cx.beginPath();for(let i=0;i<4;i++){const a=i*Math.PI/2;cx.moveTo(Math.cos(a)*R*.55,Math.sin(a)*R*.55);cx.lineTo(Math.cos(a)*R*1.15,Math.sin(a)*R*1.15);}cx.stroke();cx.restore();
    cx.font=`900 ${Math.max(13,15*K)}px ${FONT}`;cx.textAlign='center';cx.textBaseline='middle';cx.lineWidth=4;cx.strokeStyle='#3a0d22';const ty=clamp(b.ty-R-20*K,playTop+70*K,H-20);const tx=clamp(b.tx,90*K,W-90*K);
    const label=pen?'红笔圈你啦，快躲开！':'作业来啦，快躲开！';cx.strokeText(label,tx,ty);cx.fillStyle='#ffd3d8';cx.fillText(label,tx,ty);}
  const n=G.drones.length;for(let i=0;i<n;i++){const[dx,dy]=dronePos(i,n);drawDrone(cx,G.ship,dx,dy,K*1.1,vt);}
  if(G.magnet>0){cx.save();cx.translate(G.x,G.y);cx.rotate(vt*1.5);cx.strokeStyle=`rgba(255,107,125,${G.magnet<2?(Math.sin(vt*20)>0?.5:.15):.4})`;cx.lineWidth=2;cx.setLineDash([4,10]);cx.beginPath();cx.arc(0,0,250*K*.42,0,TAU);cx.stroke();cx.restore();}
  if(G.double>0){cx.save();cx.globalAlpha=.35+.15*Math.sin(vt*10);cx.strokeStyle='#ffcb47';cx.lineWidth=3;cx.beginPath();cx.arc(G.x,G.y,G.r*1.75,0,TAU);cx.stroke();cx.restore();}
  const blink=G.inv>0&&!G.ending&&Math.floor(vt*14)%2===0;
  cx.globalAlpha=blink?.4:1;
  const lost=G.ending==='lost';
  drawShip(cx,G.ship,G.x,G.y+(lost?G.spin*6*K:0),K*1.1,{t:vt,tilt:lost?G.spin:clamp(G.vx/1400,-.35,.35),sx:G.sx,sy:G.sy,mood:G.mood,thrust:clamp(1-(G.y-G.ty)/60,0.4,1.6)});
  cx.globalAlpha=1;
  if(G.shield){const R=G.r*1.65+Math.sin(vt*6)*1.5;const g=cx.createRadialGradient(G.x,G.y,R*.6,G.x,G.y,R);g.addColorStop(0,'rgba(95,198,255,0)');g.addColorStop(.85,'rgba(95,198,255,.28)');g.addColorStop(1,'rgba(220,245,255,.85)');
    cx.fillStyle=g;cx.beginPath();cx.arc(G.x,G.y,R,0,TAU);cx.fill();}
  if(b){drawBoss(cx,b,K*1.1,vt);if(b.phase==='pen'){const p=easeInOut(b.prog),x=lerp(b.sx,b.tx,p),y=lerp(b.sy,b.ty,p)-Math.sin(p*Math.PI)*60*K;drawPen(cx,x,y,Math.atan2(b.ty-b.sy,b.tx-b.sx)-Math.PI/2+Math.PI,K*1.1);}
    if(!b.leave){cx.font=`900 ${Math.max(11,13*K)}px ${FONT}`;cx.textAlign='center';cx.lineWidth=4;cx.strokeStyle='#3a0d22';cx.strokeText('生气的班主任',b.x,b.y+66*K);cx.fillStyle='#ffd3d8';cx.fillText('生气的班主任',b.x,b.y+66*K);}}}
function drawBanner(){const B=G&&G.banner;if(!B)return;const t=B.t,inT=.35,outT=.3,k=t<inT?easeOutBack(t/inT):1,a=t>B.dur-outT?(B.dur-t)/outT:1;
  const y=H*.4;cx.save();cx.globalAlpha=Math.max(0,a);cx.translate(W/2+(1-k)*-W*.15,y);cx.scale(k,k);
  const fs=Math.max(24,Math.min(40*K,W/(B.text.length*1.05+1)));cx.font=`900 ${fs}px ${FONT}`;cx.textAlign='center';cx.textBaseline='middle';cx.lineJoin='round';
  cx.fillStyle='rgba(30,18,80,.55)';let tw=cx.measureText(B.text).width;if(B.sub){cx.font=`800 ${fs*.42}px ${FONT}`;tw=Math.max(tw,cx.measureText(B.sub).width);cx.font=`900 ${fs}px ${FONT}`;}const bw=Math.min(W*.94,tw+fs*1.6);rr(cx,-bw/2,-fs*.85,bw,fs*1.7+(B.sub?fs*.7:0),fs*.4);cx.fill();
  cx.lineWidth=fs*.2;cx.strokeStyle='#241656';cx.strokeText(B.text,0,0);cx.fillStyle=B.col;cx.fillText(B.text,0,0);
  if(B.sub){cx.font=`800 ${fs*.42}px ${FONT}`;cx.fillStyle='#fff3d9';cx.fillText(B.sub,0,fs*.82);}cx.restore();}
const deco=[];function initDeco(){deco.length=0;for(let i=0;i<10;i++)deco.push({k:i<7?'coin':'book',x:Math.random()*W,y:Math.random()*H,vy:rand(12,30),ph:rand(0,TAU),rot:rand(-.5,.5),col:i%4,s:rand(.8,1.3)});}
function drawDeco(dt){for(const d of deco){d.y+=d.vy*dt*K;if(d.y>H+40){d.y=-40;d.x=Math.random()*W;}cx.globalAlpha=.55;
  if(d.k==='coin')blit(SPR.coin[((((d.ph+vt*4)/TAU)*COIN_FR)|0)%COIN_FR],d.x,d.y,d.s);else blit(SPR.books[d.col],d.x,d.y,d.s*.9,d.rot+Math.sin(vt+d.ph)*.2);}cx.globalAlpha=1;}
let lastRenderVt=0;
function render(){const dt=Math.max(0,vt-lastRenderVt);lastRenderVt=vt;cx.setTransform(DPR,0,0,DPR,0,0);drawSky();
  if(mode==='title'||mode==='over')drawDeco(mode==='over'?dt*.3:dt);
  if(G&&mode==='play'){const sh=trauma*trauma,m=14*K;cx.save();if(sh>0){cx.translate(m*sh*(.6*Math.sin(shT*41)+.4*Math.sin(shT*73)),m*.75*sh*(.6*Math.sin(shT*37+1)+.4*Math.sin(shT*61+2)));cx.rotate(.04*sh*Math.sin(shT*29));}
    drawWorld();drawParticles();drawTexts();cx.restore();drawFly();drawBanner();}
  else{drawParticles();drawTexts();}
  if(flash>0){const g=cx.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.75);g.addColorStop(0,`rgba(${flashCol},0)`);g.addColorStop(1,`rgba(${flashCol},${Math.min(.7,flash)})`);cx.fillStyle=g;cx.fillRect(0,0,W,H);}}

// ================= HUD（事件驱动：只在数值变化时写 DOM）=================
const HEART='<svg class="heart" viewBox="0 0 24 22"><path d="M12 21C5 15.5 1 11.7 1 7.2 1 3.8 3.6 1.2 6.9 1.2c2 0 3.9 1 5.1 2.6 1.2-1.6 3.1-2.6 5.1-2.6 3.3 0 5.9 2.6 5.9 6 0 4.5-4 8.3-11 13.8z" fill="#ff5d7e" stroke="#fff3d9" stroke-width="1.6"/><ellipse cx="7" cy="6.5" rx="2.4" ry="1.5" fill="#fff" opacity=".6" transform="rotate(-30 7 6.5)"/></svg>';
function hudLives(hit){const el=$('lives');if(el.children.length!==3)el.innerHTML=HEART+HEART+HEART;[...el.children].forEach((h,i)=>{const lost=i>=G.lives;h.classList.toggle('lost',lost);});
  el.setAttribute('aria-label',`剩余 ${G.lives} 颗心`);if(hit&&el.animate)el.animate([{transform:'translateX(-6px)'},{transform:'translateX(6px)'},{transform:'translateX(-3px)'},{transform:'none'}],{duration:300});}
function hudScore(){$('score').textContent=G.score;}
let comboShown=-1;
function hudCombo(){if(G.combo===comboShown)return;comboShown=G.combo;const el=$('combo');if(G.combo>=3){el.classList.add('on');$('comboN').innerHTML=`连击 ${G.combo}<em>×${multFor(G.combo)}</em>`;}else el.classList.remove('on');}
function hudTime(){const left=Math.max(0,Math.ceil(DUR-G.t));$('time').textContent=left;$('timerArc').style.strokeDashoffset=(119.38*(1-left/DUR)).toFixed(2);$('timer').classList.toggle('urgent',left<=10);}
function hudPhase(){const P=PHASES[G.phase];$('phase').textContent=G.boss?'⚠ 班主任来了':P.name;$('phase').classList.toggle('boss',!!G.boss);}
function hudSkill(){const sh=SHIPS[G.ship],k=G.coins%sh.every;$('skill').style.setProperty('--acc',sh.col);
  $('skillName').textContent=G.ship==='guoguo'?`僚机 ${G.drones.length}/4`:'激光';$('skillFill').style.width=(k/sh.every*100)+'%';$('skillTxt').textContent=`${k}/${sh.every}`;}
let powSig='';
function hudPowers(){const parts=[];if(G.magnet>0)parts.push(['magnet',Math.ceil(G.magnet)+'秒']);if(G.double>0)parts.push(['double',Math.ceil(G.double)+'秒']);if(G.shield)parts.push(['shield','护盾']);
  const sig=parts.map(p=>p.join(':')).join('|');if(sig===powSig)return;powSig=sig;$('powers').innerHTML=parts.map(([t,v])=>`<span class="pw" style="--c:${POW[t].c}"><i>${POW[t].ico}</i>${v}</span>`).join('');}
function hudAll(){comboShown=-1;powSig='-';hudLives();hudScore();hudCombo();hudTime();hudPhase();hudSkill();hudPowers();}

// ================= 界面流程（弹窗栈：✕ / 背景 / Esc 都能关）=================
const stack=[];
function openModal(id){const m=$(id);if(!m.hidden)return;m.hidden=false;stack.push(id);const f=m.querySelector('.btn.primary')||m.querySelector('.x');if(f)setTimeout(()=>{try{f.focus({preventScroll:true});}catch(e){}},30);}
function closeTop(){const id=stack.pop();if(!id)return;$(id).hidden=true;sfx('click');
  if(id==='mPause')resume();else if(id==='mOver')toTitle();
  const top=stack[stack.length-1];if(top){const f=$(top).querySelector('.btn.primary')||$(top).querySelector('.x');if(f)f.focus({preventScroll:true});}}
function closeAll(){while(stack.length)$(stack.pop()).hidden=true;}
document.querySelectorAll('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target.closest('[data-close]')&&stack[stack.length-1]===m.id)closeTop();}));
function setBody(){document.body.className='m-'+mode;}
function refreshPasses(){document.querySelectorAll('.pass').forEach(p=>{const on=p.dataset.ship===SV.ship;p.classList.toggle('sel',on);p.setAttribute('aria-checked',on);p.querySelector('.pass-best').textContent=SV.best[p.dataset.ship];});}
function selectShip(s){if(SV.ship!==s){SV.ship=s;persist();sfx('select');}refreshPasses();}
function toTitle(){closeAll();mode='title';paused=false;G=null;drag=null;keys.clear();setBody();refreshPasses();measureHud();musicHot=0;musicSync();setTimeout(()=>{try{$('bStart').focus({preventScroll:true});}catch(e){}},30);}
function startGame(){closeAll();G=newRun(SV.ship);mode='play';paused=false;overCount=null;drag=null;keys.clear();setBody();measureHud();
  const b=bounds();G.x=G.tx=W/2;G.y=G.ty=clamp(H*.76,b.y0,b.y1);G.px=G.x;hudAll();setBanner('准备出发！','收金币，躲作业本','#fff3d9');sfx('launch');addTrauma(.2);G.sy=1.25;G.sx=.8;
  SV.plays++;persist();musicHot=0;musicSync();try{cv.focus({preventScroll:true});}catch(e){}}
function pause(){if(mode!=='play'||paused||!G||G.ending)return;paused=true;drag=null;keys.clear();$('pauseInfo').textContent=`已飞行 ${Math.floor(G.t)} 秒，当前 ${G.score} 分。计时已暂停。`;openModal('mPause');musicSync();}
function resume(){if(!paused)return;paused=false;last=performance.now();musicSync();}
function finish(){const won=G.ending==='won';mode='over';overT=0;const final=Math.max(0,G.score+(won?G.bonus:0));G.final=final;
  const newRec=final>SV.best[G.ship]&&final>0;if(newRec)SV.best[G.ship]=final;
  const d=new Date(),ds=`${d.getMonth()+1}月${d.getDate()}日`;SV.top.push({score:final,ship:G.ship,won,date:ds});SV.top.sort((a,b)=>b.score-a.score);SV.top=SV.top.slice(0,8);persist();
  const md=MEDALS.find(m=>final>=m.min),el=$('medal');
  if(md){el.textContent=md.name;el.style.setProperty('--m1',md.c[0]);el.style.setProperty('--m2',md.c[1]);el.style.setProperty('--m3',md.c[2]);}
  else{el.textContent='加油';el.style.setProperty('--m1','#d9d0ff');el.style.setProperty('--m2','#8f7fd6');el.style.setProperty('--m3','#4b2f8f');}
  $('hOver').textContent=won?'下课铃响，安全返航！':'你该写作业啦';
  $('overSub').textContent=SHIPS[G.ship].name+(won?`撑过了班主任，还剩 ${G.lives} 颗心`:'已经很努力啦，休息一下再出发');
  $('overScore').textContent='0';overCount={t:0,to:final};$('newRec').hidden=!newRec;
  $('stCoins').textContent=G.coins;$('stCombo').textContent=G.maxCombo;$('stSets').textContent=G.sets;$('stBonus').textContent=won?'+'+G.bonus:'0';
  setBody();openModal('mOver');musicSync();
  if(won){for(let i=0;i<4;i++)emit(W*(.2+i*.2),-10,22,{type:2,cols:['#ffcb47','#ff5d6c','#35d9bb','#ff9152','#b9a4ff'],spd:[20,160],ang:Math.PI/2,spread:1.2,life:[1.6,2.6],size:[3,5],g:120,drag:.6});}
  if(newRec)setTimeout(()=>sfx('set'),900);}
function renderRecords(){$('bestG').textContent=SV.best.guoguo;$('bestD').textContent=SV.best.diandian;const L=$('recList');
  L.innerHTML=SV.top.length?SV.top.map(r=>`<li><span>${SHIPS[r.ship].name}<br><span class="d">${r.date}${r.won?' 安全返航':''}</span></span><span class="s">${r.score}</span></li>`).join(''):'<p class="empty">还没有纪录，快去飞一局吧！</p>';}
function syncSettingsUI(){const v={sound:SV.muted?0:1,music:SV.music?1:0,shake:SV.shake,flash:SV.flash?1:0};
  document.querySelectorAll('.seg').forEach(s=>s.querySelectorAll('button').forEach(b=>{const on=+b.dataset.v===v[s.dataset.set];b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);}));}
document.querySelectorAll('.seg').forEach(s=>s.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const v=+b.dataset.v,k=s.dataset.set;
  if(k==='sound')setMuted(!v);else if(k==='music'){SV.music=!!v;persist();musicSync();}else if(k==='shake'){SV.shake=v;persist();addTrauma(.4);}else if(k==='flash'){SV.flash=!!v;persist();}
  syncSettingsUI();sfx('click');}));
document.querySelectorAll('.pass').forEach(p=>p.addEventListener('click',()=>selectShip(p.dataset.ship)));
$('bStart').onclick=startGame;$('bAgain').onclick=startGame;$('bChange').onclick=toTitle;
$('bHelp').onclick=()=>{sfx('click');openModal('mHelp');};$('bRecords').onclick=()=>{sfx('click');renderRecords();openModal('mRecords');};$('bSettings').onclick=()=>{sfx('click');syncSettingsUI();openModal('mSettings');};
$('bPSet').onclick=()=>{sfx('click');syncSettingsUI();openModal('mSettings');};
$('bResume').onclick=()=>{if(stack[stack.length-1]==='mPause')closeTop();};
$('bRestart').onclick=()=>{closeAll();startGame();};$('bHome').onclick=()=>{closeAll();toTitle();};
$('bPause').onclick=e=>{e.currentTarget.blur();pause();};
document.querySelectorAll('.mute').forEach(b=>b.onclick=e=>{e.currentTarget.blur();setMuted(!SV.muted);});

// ================= 输入 =================
cv.addEventListener('pointerdown',e=>{if(mode!=='play'||paused||!G||G.ending==='lost')return;drag={id:e.pointerId,px:e.clientX,py:e.clientY,sx:G.tx,sy:G.ty};try{cv.setPointerCapture(e.pointerId);}catch(_){}e.preventDefault();});
cv.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id||!G)return;const M=1.35,b=bounds();let tx=drag.sx+(e.clientX-drag.px)*M,ty=drag.sy+(e.clientY-drag.py)*M;
  const cxl=clamp(tx,b.x0,b.x1),cyl=clamp(ty,b.y0,b.y1);if(cxl!==tx)drag.sx+=cxl-tx;if(cyl!==ty)drag.sy+=cyl-ty;G.tx=cxl;G.ty=cyl;e.preventDefault();});
const endDrag=e=>{if(drag&&e.pointerId===drag.id)drag=null;};cv.addEventListener('pointerup',endDrag);cv.addEventListener('pointercancel',endDrag);
addEventListener('keydown',e=>{audioUnlock();const k=e.key.toLowerCase();
  if(k==='escape'){e.preventDefault();if(stack.length)closeTop();else if(mode==='play')pause();return;}
  if(stack.length)return;
  if(mode==='play'){if(['arrowleft','arrowright','arrowup','arrowdown','a','d','w','s'].includes(k)){e.preventDefault();keys.add(k);return;}
    if(k===' '||k==='p'){e.preventDefault();pause();return;}if(k==='m'){setMuted(!SV.muted);return;}}
  else if(mode==='title'){if(k==='arrowleft'||k==='a'){selectShip('guoguo');e.preventDefault();}else if(k==='arrowright'||k==='d'){selectShip('diandian');e.preventDefault();}
    else if((k==='enter'||k===' ')&&!(document.activeElement&&document.activeElement.tagName==='BUTTON')){e.preventDefault();startGame();}else if(k==='m')setMuted(!SV.muted);}});
addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));
// 音频解锁：iOS 在 touchend 里最稳；click/pointerdown 兜底
document.addEventListener('touchend',()=>audioUnlock(),{passive:true});
document.addEventListener('click',()=>audioUnlock(),true);
document.addEventListener('pointerdown',()=>audioUnlock(),true);
['gesturestart','gesturechange','dblclick','contextmenu'].forEach(n=>document.addEventListener(n,e=>e.preventDefault(),{passive:false}));
document.addEventListener('touchmove',e=>{if(!e.target.closest('.card'))e.preventDefault();},{passive:false});
// 后台：暂停游戏 + 静音 + 停音乐 + 挂起 + audioSession 'auto'；回来后等下一次点按
function toBackground(){if(mode==='play'&&!paused&&G&&!G.ending&&!stack.length)pause();drag=null;keys.clear();audioToBackground();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)toBackground();});
addEventListener('pagehide',toBackground);addEventListener('blur',toBackground);

// ================= 尺寸变化 =================
function resize(){const oW=W,oH=H;W=innerWidth;H=innerHeight;DPR=Math.min(2,devicePixelRatio||1);cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);
  K=clamp(Math.min(W/430,H/640),.62,1.45);readSafe();measureHud();buildSprites();layoutStars();initDeco();drawPassArt();
  if(G&&oW&&oH){const fx=W/oW,fy=H/oH;for(const a of[G.cs,G.bs,G.ps,G.ink])for(const o of a){o.x*=fx;o.y*=fy;if(o.x0!==undefined)o.x0*=fx;}G.x*=fx;G.y*=fy;G.tx*=fx;G.ty*=fy;G.r=17*K;
    for(const o of G.cs)o.r=o.kind==='gem'?SPR.gemR*.95:SPR.coinR*1.05;for(const o of G.bs)o.r=SPR.bookR*(o.big?1.5:1)*.74;for(const o of G.ps)o.r=SPR.powR;
    if(G.boss){G.boss.tx*=fx;G.boss.ty*=fy;}const b=bounds();G.tx=clamp(G.tx,b.x0,b.x1);G.ty=clamp(G.ty,b.y0,b.y1);}
  render();}
let rsT=0;addEventListener('resize',()=>{clearTimeout(rsT);rsT=setTimeout(resize,60);});
addEventListener('orientationchange',()=>setTimeout(resize,250));
function drawPassArt(){document.querySelectorAll('canvas.pass-art').forEach(c=>{const r=c.getBoundingClientRect();if(!r.width)return;const d=Math.min(2,devicePixelRatio||1);c.width=r.width*d;c.height=r.height*d;const x=c.getContext('2d');x.scale(d,d);
  const w=r.width,h=r.height,ship=c.dataset.ship,col=ship==='guoguo'?['#ffe1c8','#ffc4a0']:['#d4fff5','#a6f0e2'];const g=x.createLinearGradient(0,0,0,h);g.addColorStop(0,col[0]);g.addColorStop(1,col[1]);x.fillStyle=g;x.fillRect(0,0,w,h);
  x.fillStyle='rgba(255,255,255,.7)';for(let i=0;i<14;i++){const sx=(i*53.7)%w,sy=(i*31.3)%h;x.fillRect(sx,sy,2,2);}
  drawShip(x,ship,w/2,h*.52,Math.min(w/90,h/62),{t:1.3,mood:'happy',tilt:ship==='guoguo'?-.12:.12});});
  document.querySelectorAll('canvas[data-ico]').forEach(c=>{const d=Math.min(2,devicePixelRatio||1);c.width=40*d;c.height=40*d;const x=c.getContext('2d');x.scale(d,d);const t=c.dataset.ico;
    if(t==='coin')x.drawImage(SPR.coin[0],0,0,40,40);else if(t==='book')x.drawImage(SPR.books[0],2,2,36,36);else if(t==='magnet')x.drawImage(SPR.pow.magnet,0,0,40,40);
    else if(t==='boss'){drawBoss(x,{x:20,y:22,penOut:true},.42,1);}else{drawShip(x,'guoguo',20,21,.75,{t:1,mood:'happy'});}});}

// ================= 主循环 =================
let last=performance.now(),perf={fps:60,work:0,frames:0,acc:0};
function frame(now){const dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;const t0=performance.now();
  if(!TEST)step(dt);render();if(mode==='title')musicSync();
  perf.work=perf.work*.95+(performance.now()-t0)*.05;perf.frames++;perf.acc+=dt;if(perf.acc>=1){perf.fps=perf.frames/perf.acc;perf.frames=0;perf.acc=0;}
  if(mode==='play'&&G&&G.comboT>0)$('comboFill').style.transform=`scaleX(${(G.comboT/1.6).toFixed(3)})`;
  requestAnimationFrame(frame);}

// ================= 测试接口 =================
window.advanceTime=ms=>{const n=Math.max(1,Math.round(ms/(1000/60)));for(let i=0;i<n;i++)step(1/60);render();};
window.render_game_to_text=()=>{const o={coords:'原点左上，x向右，y向下，CSS像素',mode,paused,modal:stack[stack.length-1]||null,viewport:{w:W,h:H,playTop:Math.round(playTop)},ship:SV.ship,
  audio:AU.ctx?AU.ctx.state:'none',muted:SV.muted,fx:{trauma:+trauma.toFixed(3),flash:+flash.toFixed(3),hitStop:G?+Math.max(0,G.hitStop).toFixed(3):0,particles:PT.reduce((n,p)=>n+(p.on?1:0),0)},perf:{fps:Math.round(perf.fps),workMs:+perf.work.toFixed(2)}};
  if(G){const R=v=>Math.round(v);Object.assign(o,{t:+G.t.toFixed(2),timeLeft:Math.max(0,Math.ceil(DUR-G.t)),phase:PHASES[G.phase].id,score:G.score,coins:G.coins,lives:G.lives,combo:G.combo,mult:multFor(G.combo),
    player:{x:R(G.x),y:R(G.y),r:R(G.r),inv:+G.inv.toFixed(2)},power:{magnet:+G.magnet.toFixed(1),double:+G.double.toFixed(1),shield:G.shield},drones:G.drones.length,laserQ:G.laserQ,ending:G.ending,lastHit:G.lastHit||null,lastHit:G.lastHit||null,
    coinsOnScreen:G.cs.length,books:G.bs.filter(b=>!b.dead).slice(0,12).map(b=>({x:R(b.x),y:R(b.y),r:R(b.r)})),pows:G.ps.map(p=>({x:R(p.x),y:R(p.y),type:p.type})),
    boss:G.boss?{x:R(G.boss.x),y:R(G.boss.y),phase:G.boss.phase,target:[R(G.boss.tx),R(G.boss.ty)]}:null,final:G.final});}
  return JSON.stringify(o);};
window.__game={get G(){return G;},get SV(){return SV;},setT(t){if(G){G.t=t;G.powIdx=POW_SCHED.findIndex(p=>p.t>t);if(G.powIdx<0)G.powIdx=POW_SCHED.length;}},power(t){if(G)activatePow(t);},hurt(){if(G){G.inv=0;hurt();}},
  spawnPattern(){if(G)spawnPattern();},start:startGame,toTitle,pause,select:selectShip,trauma:addTrauma,audio:()=>AU.ctx?AU.ctx.state:'none',bg:()=>AU.bg,track:()=>AU.track,
  session:()=>navigator.audioSession?navigator.audioSession.type:'n/a'};

// ================= 启动 =================
for(const b of document.querySelectorAll('.mute')){b.classList.toggle('muted',SV.muted);b.setAttribute('aria-label',SV.muted?'打开声音':'静音');}
setBody();resize();refreshPasses();syncSettingsUI();requestAnimationFrame(frame);
setTimeout(()=>{drawPassArt();},300);
})();
