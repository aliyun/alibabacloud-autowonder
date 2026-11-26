export const names = ['Atlas', 'Nova', 'Echo', 'Sage', 'Orion', 'Iris', 'Milo', 'Aria', 'Luna', 'Theo', 'Cleo', 'Finn', 'Vera', 'Remy', 'Ada', 'Leo'];
export const colors = ['#9ad7bd','#8fc8e5','#c4b3e9','#e5bd8e','#e899ad','#9ac6bb','#a9b9e5','#b9cb95','#a6c6f1','#d7b5ce','#c9d99f','#93cbd0','#e6c3a5','#b4a4dc','#9acbbb','#d4b4a3'];
import {homes,assignLoungeSpots,waitingIndex,waitingSeats,workSeats,dispatch,decisionPoint,planRoute} from './navigation.mjs';
export {homes,workSeats};
import {SUPPLY_INTERVAL,SUPPLY_BATCH,SUPPLY_DROP_TIME,PREPARATION_SECONDS} from './supply.mjs';
export const taskAge=(task,time)=>time-(task.started??time)-(task.travelDelay??0);
export function archiveTransfer(task,time){
  if(task.started===null||task.state!=='stamping')return null;
  const age=taskAge(task,time);
  return age>=66&&age<70?{taskId:task.id,from:task.agents[0],progress:(age-66)/4}:null;
}
export function dispatchTransfer(task,time){
  if(task.started===null||task.agents.length<2)return null;
  const age=taskAge(task,time);
  if(age>=4&&age<7.6){const receiver=age<5.8?0:1;return {taskId:task.id,from:7,to:task.agents[receiver],progress:(age-4-receiver*1.8)/1.8};}
  return null;
}
export function workflowStage(state){
  if(['pending','assigned','receiving'].includes(state))return 1;
  if(['working','resuming'].includes(state))return 2;
  if(['decision','reviewing'].includes(state))return 3;
  if(['delivering','stamping'].includes(state))return 4;
  return 0;
}
const phases = [
  [0,'assigned','allocated'], [4,'receiving','created'], [8,'working','collaborating'],
  [24,'working','helperDone'], [29,'decision','needsDecision'], [36,'reviewing',null],
  [41,'resuming','decisionResult'], [48,'working','continueWork'],
  [58,'delivering','resultReady'], [66,'stamping',null], [70,'done','archived']
];
export class OfficeSimulation {
  constructor({preload=true,employeeCount=16}={}) {
    this.time=0; this.nextArrival=SUPPLY_DROP_TIME; this.lastDispatch=-Infinity;this.serial=0; this.tasks=[]; this.events=[];this.stageArrivals=[0,0,0,0];this.zoneChanges=[0,0,0,0];
    this.agents = names.map((name, i) => {
      const coordinator = i === 7;
      const loungeIndex = waitingIndex(i);
      const seated = !coordinator && waitingSeats[loungeIndex] !== null;
      return {
        id: i, name, color: colors[i], state: coordinator ? 'dispatching' : 'idle', taskId: null,
        position: [...(coordinator ? dispatch.coordinator : homes[loungeIndex])],
        route: [], walk: 0, workSeatIndex: null, seatIndex: seated ? loungeIndex : null,
        seatKind: seated ? 'waiting' : null, seatBlend: seated ? 1 : 0,
      };
    });
    this.staffOrder=[7,...this.agents.filter(a=>a.id!==7).map(a=>a.id)];
    this.setInitialEmployeeCount(employeeCount);
    this.loungeSpots = new Map(this.agents.filter(a => a.state === 'idle').map(a => [a.id, waitingIndex(a.id)]));
    this.nextReadyAt=preload?SUPPLY_BATCH*PREPARATION_SECONDS:SUPPLY_DROP_TIME+PREPARATION_SECONDS;
    if(preload)for(let i=0;i<SUPPLY_BATCH;i++)this.createTask((i+1)*PREPARATION_SECONDS,true);
  }
  setInitialEmployeeCount(count){this.validateEmployeeCount(count);this.targetEmployeeCount=count;const present=new Set(this.staffOrder.slice(0,count));for(const a of this.agents)if(!present.has(a.id)){a.state='offline';a.seatBlend=0;a.position=[-12.2,-4.7];}}
  validateEmployeeCount(count){if(!Number.isInteger(count)||count<0||count>16)throw new RangeError('Employee count must be an integer from 0 to 16');}
  setEmployeeCount(count){this.validateEmployeeCount(count);this.targetEmployeeCount=count;this.manageStaff=true;}
  reconcileEmployees(){if(!this.manageStaff)return;const desired=new Set(this.staffOrder.slice(0,this.targetEmployeeCount));for(const a of this.agents){if(desired.has(a.id)){if(a.state==='offline')this.addEmployee(a.id);}else if(a.state==='idle'||(a.id===7&&a.state==='dispatching'&&!this.tasks.some(t=>t.started!==null&&t.state!=='done')))this.removeEmployee(a.id);}}
  emit(task,key) { const event={time:this.time,taskId:task.id,key,names:task.agents.map(i=>names[i])}; this.events.unshift(event);this.events=this.events.slice(0,80); task.history.push(event); }
  touchZones(...zones){for(const zone of new Set(zones))if(zone)this.zoneChanges[zone-1]++;}
  createTask(readyAt=this.time,fromStock=false) { const n=this.serial++;const task={id:`AW-${String(n+1).padStart(3,'0')}`,job:n%6,state:'pending',agents:[],started:null,readyAt,fromStock,phase:-1,progress:0,rejected:n%3===1,history:[]}; this.tasks.push(task);this.stageArrivals[0]++;this.touchZones(1);this.emit(task,'created');return task; }
  move(agent,to) {
    const departure=agent.currentZone??(agent.id===7?1:3);this.touchZones(departure);agent.currentZone=0;
    agent.destinationZone=homes.some(p=>p[0]===to[0]&&p[1]===to[1])?3:workSeats.some(p=>p[0]===to[0]&&p[1]===to[1])?2:to[0]===decisionPoint[0]&&to[1]===decisionPoint[1]?4:1;
    agent.route=planRoute(agent.position,to);
  }
  release(id) {const a=this.agents[id];a.taskId=null;a.state='returning';a.workSeatIndex=null;this.loungeDirty = true;}
  removeEmployee(id){const a=this.agents[id];if(!a||!(a.state==='idle'||(id===7&&a.state==='dispatching'&&!this.tasks.some(t=>t.started!==null&&t.state!=='done'))))return false;a.state='exiting';this.loungeDirty=true;this.move(a,[-10.4,-4.7]);a.route.push([-12.2,-4.7]);return true;}
  addEmployee(id) {
    const a = this.agents[id];
    if (!a || a.state !== 'offline') return false;
    a.state = 'entering'; a.position = [-12.2,-4.7];
    if (id === 7) a.route = [[-10.4,-4.7], ...planRoute([-10.4,-4.7], dispatch.coordinator)];
    this.loungeDirty = true;
    this.touchZones(3);
    return true;
  }
  updateLounge() {
    const resting = this.agents.filter(a => a.id !== 7 && ['idle','entering','returning'].includes(a.state));
    const next = assignLoungeSpots(resting.map(a => a.id), this.loungeSpots);
    for (const a of resting) {
      const spot = next.get(a.id);
      if (spot === this.loungeSpots.get(a.id)) continue;
      const target = homes[spot];
      if (a.position[0] < -10.65) a.route = [[-10.4,-4.7], ...planRoute([-10.4,-4.7], target)];
      else {
        a.state = 'returning';
        this.move(a, target);
      }
    }
    this.loungeSpots = next;
    this.loungeDirty = false;
  }
  get onlineCount(){return this.agents.filter(a=>a.state!=='offline').length;}
  get staffDoorOpen(){return this.agents.some(a=>['entering','exiting'].includes(a.state));}
  applyPhase(task,index) {
    const [,state,event]=phases[index];const previousStage=workflowStage(task.state),nextStage=workflowStage(state);task.phase=index;task.state=state;
    if(nextStage&&nextStage!==previousStage)this.stageArrivals[nextStage-1]++;
    const contentZones=[[1],[1],[2],[2],[2],[4],[4],[2],[2],[1],[1]];
    this.touchZones(...contentZones[index]);
    const lead=this.agents[task.agents[0]], helper=this.agents[task.agents[1]];
    if(event) this.emit(task,event==='decisionResult'?(task.rejected?'decisionRejected':'decisionApproved'):event);
    if(index===0) {this.loungeDirty=true;for(const id of task.agents){const a=this.agents[id];a.state='assigned';a.taskId=task.id;const occupied=new Set(this.agents.map(other=>other.workSeatIndex));a.workSeatIndex=workSeats.findIndex((_,i)=>!occupied.has(i));if(a.workSeatIndex<0)throw new Error('No free workstation');this.move(a,dispatch.pickups[id===lead.id?0:1]);}}
    if(index===1) {lead.state='receiving';helper.state='receiving';}
    if(index===2) {task.agents.forEach(id=>{const a=this.agents[id];a.state='working';this.move(a,workSeats[a.workSeatIndex]);});}
    if(index===3) this.release(helper.id);
    if(index===4) {lead.state='decision';this.move(lead,decisionPoint);}
    if(index===5) lead.state='reviewing';
    if(index===6) {lead.state='resuming';this.move(lead,workSeats[lead.workSeatIndex]);}
    if(index===7) lead.state='working';
    if(index===8) {lead.state='delivering';this.move(lead,dispatch.delivery);}
    if(index===9) lead.state='stamping';
    if(index===10) {task.progress=100;task.completed=this.time;this.release(lead.id);}
  }
  advance(dt) {
    // Small, bounded steps keep background-tab recovery and movement deterministic.
    let remaining=Math.min(dt,1);
    while(remaining>0){const step=Math.min(remaining,.05);remaining-=step;this.tick(step);}
  }
  tick(dt) {
    this.time+=dt;
    this.reconcileEmployees();
    if(this.time>=this.nextArrival){this.nextReadyAt=Math.max(this.nextReadyAt,this.time+PREPARATION_SECONDS);for(let i=0;i<SUPPLY_BATCH;i++)this.createTask(this.nextReadyAt+i*PREPARATION_SECONDS,true);this.nextReadyAt+=SUPPLY_BATCH*PREPARATION_SECONDS;this.nextArrival+=SUPPLY_INTERVAL;}
    for(const task of this.tasks){
      if(task.state==='pending'){
        if(this.time<task.readyAt)continue;
        const desired=new Set(this.staffOrder.slice(0,this.targetEmployeeCount));
        const free=this.agents.filter(a=>a.id!==7&&a.state==='idle'&&desired.has(a.id)).sort((a,b)=>(waitingIndex(a.id)+15-task.job)%15-(waitingIndex(b.id)+15-task.job)%15);
        const slots=new Set(this.tasks.filter(t=>t.started!==null&&t.state!=='done').map(t=>t.slot));
        if(this.agents[7].state==='dispatching'&&desired.has(7)&&free.length>=2&&slots.size<6&&this.time-this.lastDispatch>=8){this.lastDispatch=this.time;task.agents=[free[0].id,free[1].id];task.started=this.time;task.slot=[0,1,2,3,4,5].find(s=>!slots.has(s));this.applyPhase(task,0);}
      }
      if(task.started===null||task.state==='done')continue;
      // A larger room can take longer to cross. Finish approaching the desk
      // before beginning either collaborator's handoff animation.
      if(task.phase===0&&taskAge(task,this.time)>=4&&task.agents.some(id=>this.agents[id].route.length))task.travelDelay=(task.travelDelay??0)+dt;
      const age=taskAge(task,this.time);
      task.progress=Math.min(99,Math.floor(age/70*100));
      while(task.phase+1<phases.length&&age>=phases[task.phase+1][0])this.applyPhase(task,task.phase+1);
    }
    if (this.loungeDirty) this.updateLounge();
    for(const a of this.agents){
      if(a.route.length&&a.seatBlend>0){a.seatBlend=Math.max(0,a.seatBlend-dt*2.5);continue;}
      if(a.route.length){const dest=a.route[0],dx=dest[0]-a.position[0],dz=dest[1]-a.position[1],dist=Math.hypot(dx,dz),speed=4.5;
        if(dist<=speed*dt){a.position=[...dest];a.route.shift();if(!a.route.length){a.currentZone=a.destinationZone;this.touchZones(a.currentZone);}}else{a.position[0]+=dx/dist*speed*dt;a.position[1]+=dz/dist*speed*dt;}
        a.walk+=dt;
      }else{
        if(a.state==='exiting'){a.state='offline';this.touchZones(3);}
        if(a.state==='entering')a.state=a.id===7?'dispatching':'idle';
        if(a.state==='returning')a.state='idle';
        const seat = a.state === 'working' ? 'work'
          : a.state === 'idle' && waitingSeats[this.loungeSpots.get(a.id)] ? 'waiting' : null;
        if (seat) {
          a.seatKind = seat;
          a.seatIndex = seat === 'work' ? a.workSeatIndex : this.loungeSpots.get(a.id);
          a.seatBlend = Math.min(1, a.seatBlend + dt * 2.5);
        } else {
          a.seatBlend = Math.max(0, a.seatBlend - dt * 2.5);
          if (a.seatBlend === 0) a.seatKind = null;
        }
      }
    }
    // Retain recent complete histories without unbounded growth on a television.
    while(this.tasks.length>100){const index=this.tasks.findIndex(t=>t.state==='done');if(index<0)break;this.tasks.splice(index,1);}
  }
  get preparation(){return this.tasks.find(task=>task.fromStock&&this.time>=task.readyAt-PREPARATION_SECONDS&&this.time<task.readyAt)??null;}
  get fileInventory(){return {inbox:this.tasks.filter(task=>task.fromStock&&this.time<task.readyAt-PREPARATION_SECONDS).length,preparing:this.preparation?1:0,ready:this.tasks.filter(task=>task.fromStock&&this.time>=task.readyAt&&(task.started===null||taskAge(task,this.time)<4)).length};}
  get stageCounts(){const counts=[0,0,0,0];for(const task of this.tasks){const stage=workflowStage(task.state);if(stage)counts[stage-1]++;}return counts;}
  get counts(){const done=this.tasks.filter(t=>t.state==='done').length;return {total:this.serial,pending:this.tasks.filter(t=>t.state==='pending').length,active:this.tasks.filter(t=>!['pending','done'].includes(t.state)).length,done:this.serial-this.tasks.length+done};}
}
