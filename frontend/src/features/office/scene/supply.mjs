import {dispatch} from './navigation.mjs';
export const SUPPLY_INTERVAL=78;
export const SUPPLY_BATCH=3;
export const SUPPLY_DROP_TIME=4.8;
export const PREPARATION_SECONDS=2;
export const ENTRY_SECONDS=3.6;
export const EXIT_SECONDS=2.8;
export const DOOR_CLOSE_DELAY=.5;
export const door={x:-11.25,z:8.8,width:1.7,height:2.5};
export function supplyPose(time){
  const phase=time%SUPPLY_INTERVAL;
  const outside=[door.x-1.45,door.z],inside=dispatch.supervisor;
  let u=1,walking=false,visible=true,carrying=false;
  if(phase<ENTRY_SECONDS){u=phase/ENTRY_SECONDS;walking=true;carrying=true;}
  else if(phase<SUPPLY_DROP_TIME)carrying=true;
  else if(phase<SUPPLY_DROP_TIME+EXIT_SECONDS){u=1-(phase-SUPPLY_DROP_TIME)/EXIT_SECONDS;walking=true;}
  else{u=0;visible=false;}
  return {phase,position:outside.map((v,i)=>v+(inside[i]-v)*u),heading:Math.atan2(inside[0]-outside[0],inside[1]-outside[1])+(phase>=SUPPLY_DROP_TIME?Math.PI:0),walking,visible,carrying,leaving:phase>=SUPPLY_DROP_TIME,doorOpen:phase<SUPPLY_DROP_TIME+EXIT_SECONDS+DOOR_CLOSE_DELAY};
}
