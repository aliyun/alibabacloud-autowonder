import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OfficeSimulation,workflowStage,dispatchTransfer,archiveTransfer,taskAge} from './simulation.mjs';
import {pendingInbox,dispatchDesk,taskRug,loungeRug,glassPartition,decisionChairs,desks,archiveInbox,CHARACTER_SCALE,loungeSofas,loungeTables,coffeeStation,homes,planRoute,dispatch,isBlocked,workSeats,waitingIndex,waitingSeats,waitingSeatRootY} from './navigation.mjs';
import {door,supplyPose,SUPPLY_DROP_TIME,ENTRY_SECONDS,EXIT_SECONDS} from './supply.mjs';

test('automatic workflow covers collaboration, release, approval, revision and archive',()=>{
  const sim=new OfficeSimulation();
  const seen=new Set();let helperReleased=false;
  for(let i=0;i<6000;i++){
    sim.advance(.05);
    for(const event of sim.events)seen.add(event.key);
    for(const task of sim.tasks){
      if(task.phase>=3&&task.phase<10&&sim.agents[task.agents[1]].taskId!==task.id)helperReleased=true;
      if(task.state==='done'){assert.equal(task.progress,100);assert.ok(task.history.some(e=>e.key==='archived'));}
    }
    for(const a of sim.agents){assert.ok(Number.isFinite(a.position[0]));assert.ok(Number.isFinite(a.position[1]));if(a.taskId){const task=sim.tasks.find(t=>t.id===a.taskId);assert.ok(task);assert.notEqual(task.state,'done');}}
    const c=sim.counts;assert.equal(c.total,c.pending+c.active+c.done);
  }
  for(const key of ['allocated','collaborating','helperDone','needsDecision','decisionApproved','decisionRejected','continueWork','resultReady','archived'])assert.ok(seen.has(key),key);
  assert.ok(helperReleased);assert.ok(sim.counts.done>5);
});
test('a full day stays bounded and employees are never double booked',()=>{
  const sim=new OfficeSimulation();
  for(let i=0;i<86400;i++){
    sim.advance(1);
    assert.ok(sim.tasks.length<=100);
    const activeLeads=sim.tasks.filter(t=>!['pending','done'].includes(t.state)).map(t=>t.agents[0]);assert.equal(new Set(activeLeads).size,activeLeads.length);
  }
  assert.ok(sim.counts.done>1000);assert.ok(sim.events.length<=80);assert.equal(sim.counts.total,sim.counts.pending+sim.counts.active+sim.counts.done);
});

test('dispatch visitors and moving employees stay clear of solid furniture',()=>{
  const sim=new OfficeSimulation();let collected=false,delivered=false;
  assert.deepEqual(sim.agents[7].position,dispatch.coordinator);
  assert.ok(dispatch.coordinator[1]>dispatchDesk.z+dispatchDesk.d/2+.32);
  for(const p of dispatch.pickups)assert.ok(p[1]<dispatchDesk.z-dispatchDesk.d/2-.32);
  for(let i=0;i<12000;i++){
    sim.advance(.025);
    for(const task of sim.tasks){const handoff=dispatchTransfer(task,sim.time);if(handoff){assert.equal(handoff.from,7,'Aria only sends new tasks');assert.equal(sim.agents[handoff.to].route.length,0,'employees arrive before exchanging files');}}
    for(const a of sim.agents.filter(a=>a.id!==7)){
      assert.equal(isBlocked(...a.position),false,`${a.name} overlaps furniture at ${a.position}`);
      if(a.state==='receiving'&&!a.route.length){assert.ok(dispatch.pickups.some(p=>Math.hypot(p[0]-a.position[0],p[1]-a.position[1])<.01));collected=true;}
      if(a.state==='stamping'&&!a.route.length){assert.deepEqual(a.position,dispatch.delivery);delivered=true;}
    }
  }
  assert.ok(collected,'employees arrived at the pickup side');assert.ok(delivered,'results delivered directly to the archive box');
});

test('twelve work chairs are exclusive and employees stand before walking',()=>{
  const sim=new OfficeSimulation();let sawWorkingSeat=false,sawReturnSeat=false;
  assert.equal(sim.agents.filter(a=>a.id!==7).length,15);
  for (const agent of sim.agents.filter(a => a.id !== 7)) {
    const seated = Boolean(waitingSeats[waitingIndex(agent.id)]);
    assert.equal(agent.seatKind, seated ? 'waiting' : null);
    assert.equal(agent.seatBlend, Number(seated));
  }
  for(let i=0;i<6000;i++){
    const previous=sim.agents.map(a=>[...a.position]);sim.advance(.05);
    const reserved=sim.agents.filter(a=>a.workSeatIndex!==null).map(a=>a.workSeatIndex);
    assert.equal(workSeats.length,12);assert.equal(new Set(reserved).size,reserved.length);assert.ok(reserved.every(index=>index>=0&&index<12));
    for(const a of sim.agents.filter(a=>a.id!==7)){
      if(Math.hypot(previous[a.id][0]-a.position[0],previous[a.id][1]-a.position[1])>.001)assert.equal(a.seatBlend,0,'walking requires standing');
      if(a.state==='working'&&a.seatKind==='work'&&a.seatBlend===1){assert.equal(a.seatIndex,a.workSeatIndex);sawWorkingSeat=true;}
      if(sim.time>80&&a.state==='idle'&&a.seatBlend===1&&a.seatKind==='waiting')sawReturnSeat=true;
    }
  }
  assert.ok(sawWorkingSeat);assert.ok(sawReturnSeat);
});

test('workflow counters show current tasks and arrivals count every stage entry once',()=>{
  const sim=new OfficeSimulation({preload:false});sim.nextArrival=Infinity;const task=sim.createTask();
  assert.deepEqual(sim.stageCounts,[1,0,0,0]);assert.deepEqual(sim.stageArrivals,[1,0,0,0]);
  const expectations=[[1,1],[7,1],[12,2],[27,2],[33,3],[40,3],[45,2],[54,2],[63,4],[69,4],[74,0]];
  for(const [until,stage] of expectations){while(sim.time<until)sim.advance(.025);assert.equal(workflowStage(task.state),stage);assert.equal(sim.stageCounts.reduce((a,b)=>a+b,0),stage?1:0);}
  assert.deepEqual(sim.stageCounts,[0,0,0,0]);assert.deepEqual(sim.stageArrivals,[1,2,1,1]);
});

test('zone effects follow staff movements and work changes and remain quiet when idle',()=>{
  const sim=new OfficeSimulation({preload:false});sim.nextArrival=Infinity;
  sim.advance(1);assert.deepEqual(sim.zoneChanges,[0,0,0,0]);
  sim.createTask();assert.ok(sim.zoneChanges[0]>0,'dispatch reacts to a new file');
  sim.advance(.1);assert.ok(sim.zoneChanges[2]>0,'waiting zone reacts to departure');
  for(let i=0;i<2000;i++)sim.advance(.05);
  assert.ok(sim.zoneChanges.every(n=>n>0),'all four zones received relevant events');
  const settled=[...sim.zoneChanges];for(let i=0;i<200;i++)sim.advance(.05);
  assert.deepEqual(sim.zoneChanges,settled,'idle frames do not cause decorative looping');
});

test('waiting pose places thighs above cushions and shins beyond the sofa front',()=>{
  assert.ok(waitingSeatRootY+(.6-.08)*CHARACTER_SCALE>.58,'thigh underside stays above the cushion');
  assert.equal(waitingSeats.length,15);
  assert.equal(waitingSeats.filter(Boolean).length,12);
  for(const [i, seat] of waitingSeats.entries()) {
    if (!seat) continue;
    const sofa = loungeSofas[Math.floor(i / 3)];
    assert.ok(Math.abs(seat[0] - sofa.x) < sofa.w / 2);
    assert.ok(seat[1] + (.22 - .075) * CHARACTER_SCALE > sofa.z + sofa.d / 2, 'shin back clears the front fascia');
  }
});

test('Aria hands new files to both collaborators and does not receive finished results',()=>{
  const task={id:'AW-TEST',started:2,agents:[0,1]};
  assert.equal(dispatchTransfer(task,5),null);
  const first=dispatchTransfer(task,6.5);assert.equal(first.from,7);assert.equal(first.to,0);assert.ok(first.progress>0&&first.progress<1);
  const second=dispatchTransfer(task,8.5);assert.equal(second.from,7);assert.equal(second.to,1);
  assert.equal(dispatchTransfer(task,10),null);
  assert.equal(dispatchTransfer(task,69),null);
  assert.equal(dispatchTransfer(task,70),null);
});

test('inbox continuously conveys files and new human deliveries update the pending count',()=>{
  const sim=new OfficeSimulation();const until=t=>{while(sim.time<t)sim.advance(.025);};
  assert.equal(sim.counts.total,3);assert.deepEqual(sim.fileInventory,{inbox:2,preparing:1,ready:0});
  until(.1);assert.equal(sim.counts.active,0);assert.ok(supplyPose(.1).walking&&supplyPose(.1).carrying&&supplyPose(.1).doorOpen);
  until(4.7);const before=sim.counts.pending;
  until(4.9);assert.equal(sim.counts.total,6);assert.equal(sim.counts.pending,before+3);
  until(12.9);assert.equal(sim.fileInventory.inbox,0);assert.equal(sim.fileInventory.preparing,0);
  until(82.9);assert.equal(sim.counts.total,9);assert.ok(sim.fileInventory.inbox>0);
  assert.equal(supplyPose(75).visible,false);assert.equal(supplyPose(79).carrying,true);
});

test('released employees exit through the staff door and rejoin without taking tasks offsite',()=>{
  const sim=new OfficeSimulation({preload:false});sim.nextArrival=Infinity;
  assert.equal(sim.removeEmployee(16),false);assert.equal(sim.removeEmployee(0),true);
  assert.equal(sim.staffDoorOpen,true);
  for(let i=0;i<200;i++)sim.advance(.05);
  assert.equal(sim.agents[0].state,'offline');assert.equal(sim.onlineCount,15);assert.equal(sim.staffDoorOpen,false);
  for(let i=0;i<10;i++)sim.createTask();sim.advance(.1);
  assert.equal(sim.agents[0].taskId,null);assert.equal(sim.addEmployee(0),true);assert.equal(sim.addEmployee(0),false);
  for(let i=0;i<200;i++)sim.advance(.05);
  assert.equal(sim.onlineCount,16);assert.ok(!['offline','entering'].includes(sim.agents[0].state));
  assert.equal(sim.removeEmployee(sim.tasks.find(t=>t.started!==null).agents[0]),false);
});

test('hundreds of queued files pass the belt once each without dropping tasks',()=>{
  const sim=new OfficeSimulation({preload:false});sim.nextArrival=Infinity;
  for(let i=0;i<300;i++)sim.createTask((i+1)*2,true);
  for(let i=0;i<700;i++)sim.advance(1);
  assert.equal(sim.counts.total,300);assert.equal(sim.counts.total,sim.counts.pending+sim.counts.active+sim.counts.done);
  assert.equal(sim.fileInventory.inbox,0);assert.equal(new Set(sim.tasks.map(t=>t.id)).size,sim.tasks.length);
});

test('lounge spots are distinct, inside the rug and reachable from task and work areas',()=>{
  assert.equal(homes.length,15);assert.equal(new Set(homes.map(p=>p.join(','))).size,15);
  assert.equal(new Set(workSeats.map(p=>p[1])).size,3);
  for(const [i,start] of homes.entries()){
    assert.ok(start[0] > 2.1 && start[0] < 10.4 && start[1] > -8.35 && start[1] < .25);
    for(const end of [[-10.4, -4.7],dispatch.pickups[i%2],workSeats[i%12]]){
      let previous=start;
      for(const next of planRoute(start,end)){
        const steps=Math.ceil(Math.hypot(next[0]-previous[0],next[1]-previous[1])/.05);
        for(let k=0;k<=steps;k++)assert.equal(isBlocked(previous[0]+(next[0]-previous[0])*k/steps,previous[1]+(next[1]-previous[1])*k/steps),false);
        previous=next;
      }
    }
  }
});

test('population supports zero through sixteen and safely drains active work before leaving',()=>{
  const sim=new OfficeSimulation({preload:false,employeeCount:0});sim.nextArrival=Infinity;
  assert.equal(sim.onlineCount,0);const task=sim.createTask();sim.advance(1);assert.equal(task.started,null);
  for(const count of [1,8,16]){sim.setEmployeeCount(count);for(let i=0;i<30;i++)sim.advance(1);assert.equal(sim.onlineCount,count);}
  sim.setEmployeeCount(0);for(let i=0;i<120;i++)sim.advance(1);
  assert.equal(sim.onlineCount,0);assert.equal(task.state,'done');assert.ok(sim.agents.every(a=>a.taskId===null));
  sim.setEmployeeCount(16);for(let i=0;i<30;i++)sim.advance(1);assert.equal(sim.onlineCount,16);
  const idle = sim.agents.filter(a => a.state === 'idle');
  assert.equal(idle.length,15);
  assert.equal(idle.filter(a => a.seatBlend === 1).length,waitingSeats.filter(Boolean).length);
  for (const agent of idle) {
    const index = waitingIndex(agent.id);
    assert.deepEqual(agent.position, homes[index]);
    assert.equal(agent.seatKind, waitingSeats[index] ? 'waiting' : null);
  }
  for(const invalid of [-1,17,1.5,NaN])assert.throws(()=>sim.setEmployeeCount(invalid),RangeError);
});

test('door stays open until the empty-handed courier has fully exited',()=>{
  for(let t=0;t<SUPPLY_DROP_TIME+EXIT_SECONDS;t+=.05)assert.equal(supplyPose(t).doorOpen,true);
  const outgoing=supplyPose(SUPPLY_DROP_TIME+.2);assert.ok(outgoing.walking&&outgoing.leaving&&!outgoing.carrying);
  const outside=supplyPose(SUPPLY_DROP_TIME+EXIT_SECONDS+.1);assert.equal(outside.visible,false);assert.equal(outside.doorOpen,true);
  assert.equal(supplyPose(13).doorOpen,false);assert.equal(supplyPose(78.5).doorOpen,true);assert.equal(supplyPose(78.5).carrying,true);
  const distance=Math.hypot(dispatch.supervisor[0]-door.x+1.45,dispatch.supervisor[1]-door.z);assert.ok(distance/EXIT_SECONDS>distance/ENTRY_SECONDS);assert.ok(distance/EXIT_SECONDS<4.5);
});

test('the coffee bar, sofas and workstations preserve passages around the decision lounge',()=>{
  assert.equal(loungeSofas.length,4);
  assert.equal(new Set(loungeSofas.map(sofa => sofa.z)).size,2);
  assert.equal(loungeTables.length,2);
  assert.ok(coffeeStation.z - coffeeStation.d / 2 > glassPartition.z);
  assert.ok(coffeeStation.x - coffeeStation.w / 2 > 2.1);
  assert.ok(loungeSofas.every(sofa => sofa.z + sofa.d / 2 < glassPartition.z));
  assert.ok(decisionChairs.every(([, z]) => z > glassPartition.z));
  const rightmostDesk = Math.max(...desks.map(([x]) => x + 1.75));
  assert.ok(rightmostDesk < 0);
  assert.ok(Math.min(...decisionChairs.map(([x]) => x - .425)) - rightmostDesk >= 1);
  assert.equal(dispatchDesk.x,(taskRug.left+taskRug.right)/2);
  assert.equal(dispatchDesk.z,(taskRug.back+taskRug.front)/2);
  assert.ok(pendingInbox.x < dispatchDesk.x && archiveInbox.x > dispatchDesk.x);
  assert.ok(Math.abs(glassPartition.z + glassPartition.d / 2 - loungeRug.front) < 1e-8);
  assert.ok(Math.abs(glassPartition.x - glassPartition.w / 2 - loungeRug.left) < 1e-8);
  assert.ok(Math.abs(glassPartition.x + glassPartition.w / 2 - loungeRug.right) < 1e-8);
  assert.ok(archiveInbox.z<pendingInbox.z,'the archive chest sits behind intake');
});

test('returned files are stamped then deposited in the completed box before the count increments',()=>{
  const sim=new OfficeSimulation({preload:false});sim.nextArrival=Infinity;
  const task=sim.createTask();while(sim.time<.1)sim.advance(.025);
  while(taskAge(task,sim.time)<68.9)sim.advance(.025);
  const deposit=archiveTransfer(task,sim.time);assert.ok(deposit);assert.ok(deposit.progress>0&&deposit.progress<1);
  assert.equal(deposit.from,task.agents[0]);assert.notEqual(deposit.from,7);
  assert.equal(sim.counts.done,0);assert.equal(task.state,'stamping');
  while(taskAge(task,sim.time)<72.1)sim.advance(.025);
  assert.equal(archiveTransfer(task,sim.time),null);assert.equal(sim.counts.done,1);assert.equal(task.state,'done');
  assert.equal(archiveTransfer({started:null,state:'pending'},0),null);
});

test('completed work goes directly to the archive while Aria continues dispatching',()=>{
  const sim=new OfficeSimulation({preload:false});sim.nextArrival=Infinity;
  for(let i=0;i<12;i++)sim.createTask();let independent=false;
  for(let i=0;i<6000;i++){
    sim.advance(.025);assert.deepEqual(sim.agents[7].position,dispatch.coordinator);assert.equal(sim.agents[7].route.length,0);
    const deposits=sim.tasks.map(task=>archiveTransfer(task,sim.time)).filter(Boolean);
    if(deposits.length&&sim.tasks.some(task=>dispatchTransfer(task,sim.time)))independent=true;
    for(const task of sim.tasks.filter(task=>['delivering','stamping'].includes(task.state))){
      const courier=sim.agents[task.agents[0]];
      assert.deepEqual(courier.route.at(-1)??courier.position,dispatch.delivery);
      assert.ok(Math.abs(dispatch.delivery[0]-archiveInbox.x)<.01);
      assert.ok(Math.hypot(...dispatch.delivery.map((v,j)=>v-dispatch.coordinator[j]))>3);
    }
  }
  assert.ok(independent,'archiving does not require the dispatcher');
});

test('courier door sweep and the human carrying route clear the dispatch counter',()=>{
  const counterFront=dispatchDesk.z+dispatchDesk.d/2;
  assert.ok(door.x + door.width + .29 < dispatchDesk.x - dispatchDesk.w / 2 || door.z-door.width/2 > counterFront+.5,'the entire door sweep is beyond the counter');
  for(let time=0;time<=SUPPLY_DROP_TIME+EXIT_SECONDS;time+=.025){
    const [x,z]=supplyPose(time).position;
    assert.ok(Math.abs(x-dispatchDesk.x)>dispatchDesk.w/2+.3||Math.abs(z-dispatchDesk.z)>dispatchDesk.d/2+.3,'courier avoids the table');
  }
  for(const [x] of dispatch.pickups)assert.ok(archiveInbox.x-x>2,'the completed chest leaves pickup employees unobstructed');
});
