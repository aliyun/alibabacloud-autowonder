// Furniture footprints in office coordinates. Paths reserve room for the body,
// not just the agent's centre point. Keep these aligned with scene geometry.
export const BODY_RADIUS = .29;
export const CHARACTER_SCALE=.9;
export const taskRug = { left: -10.4, right: -.2, back: 4.35, front: 9.35 };
export const dispatchDesk = {
  x: (taskRug.left + taskRug.right) / 2, z: (taskRug.back + taskRug.front) / 2, w: 7.6, d: 1.5,
};
const { x: deskX, z: deskZ } = dispatchDesk;
export const pendingInbox = { x: deskX - 2.58, z: deskZ, slotY: 2.01, slotZ: deskZ - .13 };
export const archiveInbox = { x: deskX + 2.62, z: deskZ - .08, slotY: 2.01, slotZ: deskZ - .21 };
export const dispatch = {
  coordinator: [deskX, deskZ + 1.25], supervisor: [pendingInbox.x, deskZ + 1.6],
  pickups: [[deskX - 1.15, deskZ - 1.25], [deskX - .25, deskZ - 1.25]],
  delivery: [archiveInbox.x, deskZ - 1.25],
};
const sofaColumns = [4.55, 8.1];
export const loungeSofas = [-4.65, -7.4].flatMap(z => sofaColumns.map(x => ({ x, z, w: 2.65, d: 1.02 })));
export const loungeTables = sofaColumns.map(x => ({ x, z: -2.4, r: .42 }));
export const coffeeStation = { x: 8, z: 1.55, w: 3.8, d: .78 };
export const sofaSeatOffsets = [-.74, 0, .74];
const loungeSeats = loungeSofas.flatMap(({ x, z }) => sofaSeatOffsets.map(offset => [x + offset, z + .4]));
const loungeStanding = [[3.45, -1.4], [6.3, -1.45], [8.75, -1.35]];
export const homes = [...loungeSeats.map(([x, z]) => [x, z + .59]), ...loungeStanding];
export const waitingIndex=id=>id<7?id:id-1;
// Hips stay near the cushion's front edge so bent shins clear the sofa fascia.
export const waitingSeats = [...loungeSeats, ...loungeStanding.map(() => null)];
// Keep occupied seats, then promote waiting employees before seating new arrivals.
export function assignLoungeSpots(ids, previous) {
  const wanted = new Set(ids);
  const result = new Map();
  const taken = new Set();
  function reserve(id, spot) { result.set(id, spot); taken.add(spot); }
  for (const [id, spot] of previous) {
    if (wanted.has(id) && waitingSeats[spot]) reserve(id, spot);
  }
  const queue = [...new Set([...previous.keys(), ...ids])].filter(id => wanted.has(id) && !result.has(id));
  for (const id of queue) {
    const seat = waitingSeats.findIndex((point, i) => point && !taken.has(i));
    if (seat >= 0) reserve(id, seat);
  }
  for (const id of queue) {
    if (!result.has(id) && previous.has(id) && !taken.has(previous.get(id))) reserve(id, previous.get(id));
  }
  for (const id of queue) {
    if (!result.has(id)) reserve(id, homes.findIndex((_, i) => !taken.has(i)));
  }
  return result;
}
export const waitingSeatRootY=.13;
export const desks=[-7, -3.35, .3].flatMap(z => [[-7.5, z], [-2.55, z]]);
export const workSeats = desks.flatMap(([x,z])=>[[x-.65,z+1.8],[x+.75,z+1.8]]);
// Working employees beyond the twelve desk chairs stand in the aisle between desk groups.
export const workPositions = [...workSeats, ...[-7, -3.35, .3].map(z => [-5.05, z])];
export const chairSeats=workSeats.map(([x,z])=>[x,z-.8]);
export const decisionPoint = [3.45, 4.4];
export const decisionTable = { x: 5.8, z: 3.55, r: .95 };
export const decisionChairs=[[4.65, 2.5], [7.15, 3], [6, 5]];
export const loungeRug = { left: 2.1, right: 10.4, back: -8.35, front: .25 };
export const carpetBinding = .14;
const glassDepth = .08;
export const glassPartition = {
  x: (loungeRug.left + loungeRug.right) / 2, z: loungeRug.front - glassDepth / 2,
  w: loungeRug.right - loungeRug.left, d: glassDepth,
};
export const plants = [[9.73,-3.05,.9],[-9.83,-7.77,.9],[2.73,-6.1,.75],[2.85,8.53,.85]];
export const planter={x:8.16,z:8.65,w:3.6,d:.6};
export const furniture = [
  dispatchDesk,
  ...desks.flatMap(([x,z])=>[
    {x,z,w:3.5,d:1.5},
    {x:x-.65,z:z+1,w:.8,d:.8},
    {x:x+.75,z:z+1,w:.8,d:.8}
  ]),
  ...loungeSofas, ...loungeTables,
  coffeeStation, glassPartition,
  decisionTable,
  ...decisionChairs.map(([x,z])=>({x,z,w:.85,d:.85})),
  planter,
  ...plants.map(([x,z,s])=>({x,z,r:.55*s})),
  {x:dispatch.supervisor[0],z:dispatch.supervisor[1],r:.3}
];
export function isBlocked(x,z){
  if(x < -10.65 || x > 10.65 || z < -8.65 || z > 10.65)return true;
  return furniture.some(o=>'r' in o?Math.hypot(x-o.x,z-o.z)<o.r+BODY_RADIUS:
    Math.abs(x-o.x)<o.w/2+BODY_RADIUS&&Math.abs(z-o.z)<o.d/2+BODY_RADIUS);
}
function clearSegment(a,b){
  if(isBlocked(...a)||isBlocked(...b))return false;
  const dx=b[0]-a[0],dz=b[1]-a[1],length2=dx*dx+dz*dz;
  return !furniture.some(o=>{
    if('r' in o){const u=length2?Math.max(0,Math.min(1,((o.x-a[0])*dx+(o.z-a[1])*dz)/length2)):0;
      return Math.hypot(a[0]+dx*u-o.x,a[1]+dz*u-o.z)<=o.r+BODY_RADIUS;}
    let lo=0,hi=1;
    for(const [origin,delta,min,max] of [[a[0],dx,o.x-o.w/2-BODY_RADIUS,o.x+o.w/2+BODY_RADIUS],[a[1],dz,o.z-o.d/2-BODY_RADIUS,o.z+o.d/2+BODY_RADIUS]]){
      if(Math.abs(delta)<1e-9){if(origin<min||origin>max)return false;}
      else{const u=(min-origin)/delta,v=(max-origin)/delta;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>hi)return false;}
    }
    return lo<=hi;
  });
}
const STEP=.25, WIDTH=85, HEIGHT=77;
const point=id=>[-10.5+(id%WIDTH)*STEP,-8.5+Math.floor(id/WIDTH)*STEP];
const cell=p=>Math.round((p[1]+8.5)/STEP)*WIDTH+Math.round((p[0]+10.5)/STEP);
const blocked=Array.from({length:WIDTH*HEIGHT},(_,i)=>isBlocked(...point(i)));
const cache=new Map();
export function planRoute(start,end){
  if(isBlocked(...start)||isBlocked(...end))throw new Error('Navigation endpoint intersects furniture');
  if(clearSegment(start,end))return [[...end]];
  const from=cell(start),to=cell(end),key=`${from}:${to}`;
  let cells=cache.get(key);
  if(!cells){
    const costs=new Float64Array(WIDTH*HEIGHT).fill(Infinity),parents=new Int32Array(WIDTH*HEIGHT).fill(-1),closed=new Set();
    const heuristic=id=>Math.hypot(...point(id).map((v,i)=>v-point(to)[i]));
    const open=[from];costs[from]=0;
    while(open.length){
      let best=0;for(let i=1;i<open.length;i++)if(costs[open[i]]+heuristic(open[i])<costs[open[best]]+heuristic(open[best]))best=i;
      const current=open.splice(best,1)[0];if(current===to)break;closed.add(current);
      const x=current%WIDTH,y=Math.floor(current/WIDTH);
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
        const nx=x+dx,ny=y+dy;if(nx<0||nx>=WIDTH||ny<0||ny>=HEIGHT)continue;
        const next=ny*WIDTH+nx;if(blocked[next]||closed.has(next))continue;
        if(dx&&dy&&(blocked[y*WIDTH+nx]||blocked[ny*WIDTH+x]))continue;
        if(!clearSegment(point(current),point(next)))continue;
        const cost=costs[current]+Math.hypot(dx,dy)*STEP;
        if(cost<costs[next]){costs[next]=cost;parents[next]=current;if(!open.includes(next))open.push(next);}
      }
    }
    if(parents[to]===-1)throw new Error('No walkable office route');
    cells=[];for(let id=to;id!==from;id=parents[id])cells.unshift(point(id));
    cache.set(key,cells);
  }
  // Smooth only with line-of-sight checks against the same expanded footprints.
  const raw=[[...start],point(from),...cells,[...end]],result=[];let i=0;
  while(i<raw.length-1){let j=raw.length-1;while(j>i+1&&!clearSegment(raw[i],raw[j]))j--;result.push([...raw[j]]);i=j;}
  return result;
}
