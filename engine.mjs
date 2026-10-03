export const DURATION=60;
export function createGame(w,h,ship='guoguo'){return{w,h,ship,x:w/2,y:h*.79,r:20,time:DURATION,score:0,lives:3,invulnerable:0,coinClock:.15,bookClock:1.2,items:[],status:'playing',age:0,drones:[],droneId:0,lasers:[],laserQueue:0,laserCooldown:0,skillCount:0,boss:null}}
export function clampPlayer(g){g.x=Math.max(25,Math.min(g.w-25,g.x));g.y=Math.max(35,Math.min(g.h-28,g.y))}
export function dronePositions(g){return g.drones.map((d,i)=>{const a=g.age*2.5+i*Math.PI*2/g.drones.length;return{id:d,x:g.x+Math.cos(a)*56,y:g.y+Math.sin(a)*56,r:13}})}
export function difficulty(g){const p=Math.min(1,g.age/DURATION);return{level:Math.min(4,1+Math.floor(g.age/15)),speed:(g.h/560)*(125+230*p),interval:1.05-.76*p}}
function award(g,item,events){if(item.hit)return;item.hit=true;g.score++;events.push({type:'coin',x:item.x,y:item.y});const every=g.ship==='guoguo'?10:5;const earned=Math.floor(g.score/every);while(g.skillCount<earned){g.skillCount++;if(g.ship==='guoguo'){g.drones.push(++g.droneId);events.push({type:'drone',x:g.x,y:g.y})}else g.laserQueue++}}
function laserHits(g,beam,events){for(const i of g.items){if(i.hit||i.y<0||i.y>beam.y||Math.abs(i.x-beam.x)>beam.width/2+i.r*.6)continue;if(i.kind==='coin')award(g,i,events);else{i.hit=true;events.push({type:'burn',x:i.x,y:i.y})}}}
function hurt(g,events){if(g.invulnerable>0||g.status!=='playing')return;g.lives--;g.invulnerable=1.6;events.push({type:'hit',x:g.x,y:g.y});if(g.lives<=0){g.status='lost';events.push({type:'end'})}}
export function bossStep(g,dt,events){
if(g.age<45)return;
if(!g.boss){g.boss={x:g.w/2,y:65,phase:'idle',clock:.9,attack:0,targetX:g.x,targetY:g.y,progress:0,clawHit:false};events.push({type:'boss'})}
const b=g.boss;b.x=g.w/2+Math.sin((g.age-45)*.65)*g.w*.23;b.y=65;b.clock-=dt;
if(b.phase==='idle'&&b.clock<=0){b.phase=b.attack%2===0?'throwWarn':'clawWarn';b.clock=.95;b.targetX=g.x;b.targetY=g.y;b.progress=0;b.clawHit=false;events.push({type:'warning',attack:b.phase})}
else if(b.phase==='throwWarn'&&b.clock<=0){const angle=Math.atan2(b.targetY-b.y,b.targetX-b.x),speed=g.h*.65;for(const offset of[-.32,0,.32]){const a=angle+offset;g.items.push({kind:'book',x:b.x,y:b.y+25,r:21,speed:0,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,angle:a-Math.PI/2,bossShot:true})}b.phase='idle';b.clock=1.45;b.attack++;events.push({type:'throw'})}
else if(b.phase==='clawWarn'&&b.clock<=0){b.phase='claw';b.clock=1.15;b.progress=0;events.push({type:'claw'})}
else if(b.phase==='claw'){const elapsed=1.15-Math.max(0,b.clock);b.progress=elapsed<.35?elapsed/.35:elapsed<.8?1:Math.max(0,(1.15-elapsed)/.35);const x=b.x+(b.targetX-b.x)*b.progress,y=b.y+(b.targetY-b.y)*b.progress;if(!b.clawHit&&b.progress>.9){const d=dronePositions(g).find(d=>Math.hypot(d.x-x,d.y-y)<d.r+27);if(d){g.drones=g.drones.filter(id=>id!==d.id);b.clawHit=true;events.push({type:'droneLost',x:d.x,y:d.y})}else if(Math.hypot(g.x-x,g.y-y)<g.r+25){b.clawHit=true;hurt(g,events)}}if(b.clock<=0){b.phase='idle';b.clock=1.1;b.attack++;b.progress=0}}
}
export function update(g,dt,rand=Math.random){if(g.status!=='playing')return[];dt=Math.max(0,Math.min(.05,dt));g.age+=dt;g.time=Math.max(0,DURATION-g.age);g.invulnerable=Math.max(0,g.invulnerable-dt);const events=[];
if(g.time<=0){g.status='won';events.push({type:'end'});return events}
bossStep(g,dt,events);if(g.status!=='playing')return events;const{speed,interval}=difficulty(g);g.coinClock-=dt;g.bookClock-=dt;
if(g.coinClock<=0){g.coinClock+=.3;g.items.push({kind:'coin',x:30+rand()*(g.w-60),y:-25,r:14,speed:speed*(.7+rand()*.18),angle:0})}
if(g.bookClock<=0){g.bookClock+=interval;g.items.push({kind:'book',x:35+rand()*(g.w-70),y:-32,r:21,speed:speed*(.9+rand()*.22),angle:(rand()-.5)*.5})}
for(const item of g.items){item.y+=(item.vy??item.speed)*dt;item.x+=(item.vx||0)*dt;}
g.laserCooldown=Math.max(0,g.laserCooldown-dt);for(const beam of g.lasers)beam.life-=dt;g.lasers=g.lasers.filter(b=>b.life>0);for(const beam of g.lasers)laserHits(g,beam,events);
if(g.ship==='diandian'&&g.laserQueue>0&&g.laserCooldown<=0){const beam={x:g.x,y:g.y,width:72,life:.35};g.lasers.push(beam);g.laserQueue--;g.laserCooldown=.4;events.push({type:'laser',x:g.x,y:g.y});laserHits(g,beam,events)}
const drones=dronePositions(g);
for(const item of g.items){if(item.hit)continue;const escort=drones.find(d=>g.drones.includes(d.id)&&Math.hypot(item.x-d.x,item.y-d.y)<d.r+item.r-3);if(escort){if(item.kind==='coin')award(g,item,events);else{item.hit=true;g.drones=g.drones.filter(id=>id!==escort.id);events.push({type:'droneLost',x:escort.x,y:escort.y})}continue}
if(Math.hypot(item.x-g.x,item.y-g.y)<g.r+item.r-5){if(item.kind==='coin')award(g,item,events);else if(g.invulnerable<=0){item.hit=true;hurt(g,events);if(g.status==='lost')break}}}
g.items=g.items.filter(i=>!i.hit&&i.y<g.h+60&&i.x>-80&&i.x<g.w+80);return events}
