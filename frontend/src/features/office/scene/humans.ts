import * as THREE from 'three';

// Soft sculpted geometry: distinct human silhouettes, not robot bodies with
// substituted heads. All details remain real meshes under the office lighting.
const palettes=[
  {skin:0xe0ad89,hair:0x573528,jacket:0x39928a,shirt:0xf3ece0,pants:0x3b5877,shoe:0xe5dfce},
  {skin:0xc28d68,hair:0x302d38,jacket:0x4d6694,shirt:0xe4e9e3,pants:0x354257,shoe:0xd9dfd9},
  {skin:0xf0c2a3,hair:0xe5ad38,jacket:0x9b85c4,shirt:0xf5eee2,pants:0x45425c,shoe:0xf1e4cf}
];
export function createHuman(style:0|1|2,seated=false){
  const p=palettes[style],group=new THREE.Group();
  const materials=new Map<number,THREE.MeshStandardMaterial>();
  const material=(color:number)=>{if(!materials.has(color))materials.set(color,new THREE.MeshStandardMaterial({color,roughness:.78,metalness:0}));return materials.get(color)!;};
  function oval(parent:THREE.Object3D,color:number,x:number,y:number,z:number,sx:number,sy:number,sz:number){const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  function limb(parent:THREE.Object3D,color:number,a:number[],b:number[],radius:number){const from=new THREE.Vector3(...a as [number,number,number]),to=new THREE.Vector3(...b as [number,number,number]);const length=from.distanceTo(to);const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,Math.max(.001,length-2*radius),6,12),material(color));mesh.position.copy(from).add(to).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),to.sub(from).normalize());mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  function curve(parent:THREE.Object3D,color:number,points:number[][],radius:number){const path=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p as [number,number,number])));const mesh=new THREE.Mesh(new THREE.TubeGeometry(path,16,radius,6,false),material(color));parent.add(mesh);return mesh;}
  const torsoY=seated?1.05:1.18,headY=seated?1.64:1.8,hipY=seated?.66:.82;
  oval(group,p.pants,0,hipY,0,.265,.17,.19);
  oval(group,p.jacket,0,torsoY,0,.32,.39,.22);
  oval(group,p.shirt,0,torsoY+.07,.181,.16,.27,.065);
  // Contemporary layered streetwear: a zip jacket, an overshirt, a lilac bomber.
  if(style===1){for(const sign of [-1,1]){const lapel=oval(group,p.jacket,sign*.14,torsoY+.14,.225,.075,.23,.035);lapel.rotation.z=sign*.22;}for(let i=0;i<2;i++)oval(group,0xc2ccdb,0,torsoY-.08-i*.13,.235,.018,.018,.012);}
  else{
    curve(group,style===0?0x235e5b:0x76639d,[[-.15,torsoY+.29,.16],[0,torsoY+.25,.24],[.15,torsoY+.29,.16]],.03);
    for(const sign of [-1,1]){limb(group,p.shirt,[sign*.1,torsoY+.24,.24],[sign*.12,torsoY-.25,.23],.012);limb(group,p.jacket,[sign*.17,torsoY-.15,.23],[sign*.23,torsoY-.05,.2],.02);}
    oval(group,p.shirt,.19,torsoY+.1,.213,.025,.045,.015);
  }
  limb(group,p.skin,[0,headY-.35,0],[0,headY-.2,0],.105);
  const head=new THREE.Group();head.position.set(0,headY,0);group.add(head);
  if (style === 1) {
    head.scale.set(.76, .79, .75);
    head.position.y -= .042;
  }
  oval(head,p.skin,0,0,0,style===1?.29:.305,.345,.27);
  oval(head,p.skin,0,-.16,.045,.235,.16,.21); // tapered cheeks and chin
  for(const sign of [-1,1]){
    oval(head,p.skin,sign*.298,-.015,0,.062,.095,.05);
    oval(head,0xc98f79,sign*.31,-.015,.025,.025,.045,.018);
    oval(head,0xf7f3e9,sign*.105,.035,.242,.064,.073,.035);
    oval(head,0x46372f,sign*.103,.03,.271,.031,.043,.017);
    oval(head,0xfffbef,sign*.094,.046,.285,.009,.012,.005);
    curve(head,p.hair,[[sign*.055,.141,.241],[sign*.108,.161,.24],[sign*.16,.145,.22]],.018);
    if (style !== 1) oval(head,0xd98e7d,sign*.177,-.09,.229,.055,.026,.015);
  }
  oval(head,p.skin,0,-.055,.281,.052,.075,.061);
  curve(head,0x8c5347,[[-.077,-.155,.244],[0,-.177,.259],[.077,-.155,.244]],.012);
  if (style !== 1) oval(head,p.hair,0,.18,-.055,.315,.215,.265);
  if(style===0){
    // Neat cropped sides and a swept textured top, with the ears exposed.
    for(const sign of [-1,1])oval(head,p.hair,sign*.25,.12,-.07,.067,.145,.18);
    const fringe=oval(head,p.hair,-.055,.25,.13,.25,.105,.15);fringe.rotation.z=.25;
    oval(head,0x79523c,-.14,.305,.015,.14,.035,.16);
  }else if(style===1){
    // A single cropped silhouette follows the skull, with a swept hairline over the brow.
    const crop = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI*2, 0, Math.PI/2);
    const { position, uv } = crop.attributes;
    for (let i = 0; i < position.count; i++) {
      const angle = uv.getX(i) * Math.PI*2, v = 1 - uv.getY(i);
      const side = -Math.cos(angle), forward = Math.sin(angle);
      const fringe = Math.max(0, forward);
      const hairline = 1.57 - .56*fringe + .57*Math.max(0, -forward) + .17*side*fringe;
      const pitch = v*hairline, radius = Math.sin(pitch);
      const tuck = 1 - .045 * v**12;
      position.setXYZ(i, .308*side*radius*tuck, .368*Math.cos(pitch) + .012*fringe*radius,
        .287*forward*radius*tuck - .006);
    }
    crop.computeVertexNormals();
    const hair = new THREE.Mesh(crop, material(p.hair));
    hair.castShadow = hair.receiveShadow = true;
    head.add(hair);
    for(const sign of [-1,1]){
      const rim=new THREE.Mesh(new THREE.TorusGeometry(.088,.012,6,24),material(0x4e4c50));rim.scale.y=.82;rim.position.set(sign*.108,.035,.292);head.add(rim);
      limb(head,0x4e4c50,[sign*.19,.045,.28],[sign*.29,.045,.02],.012);
    }
    limb(head,0x4e4c50,[-.022,.045,.295],[.022,.045,.295],.012);
  }else{
    // Golden side-swept fringe and a high ponytail, rather than grey curls.
    for(const sign of [-1,1])oval(head,p.hair,sign*.255,.055,-.09,.082,.195,.17);
    const fringe=oval(head,p.hair,-.065,.24,.15,.25,.12,.13);fringe.rotation.z=.25;
    oval(head,0xf1c95d,-.14,.305,.02,.12,.04,.17);
    const tail=oval(head,p.hair,.08,.12,-.29,.115,.255,.115);tail.rotation.x=-.3;
    oval(head,0x786092,.07,.29,-.24,.08,.034,.07);
  }
  const legGroups:THREE.Group[]=[];
  for(const sign of [-1,1]){
    const x=sign*.14,knee=seated?[x,.62,.38]:[x,.46,.015],ankle=seated?[x,.15,.45]:[x,.14,.025];
    const leg=new THREE.Group();group.add(leg);leg.position.set(x,hipY,0);legGroups.push(leg);
    const relative=(p:number[])=>[p[0]-x,p[1]-hipY,p[2]];
    limb(leg,p.pants,[0,0,0],relative(knee),.105);limb(leg,p.pants,relative(knee),relative(ankle),.09);
    oval(leg,p.shoe,0,.1-hipY,seated?.53:.105,.12,.09,.205);
    oval(leg,0xf1eddf,0,.055-hipY,seated?.53:.105,.122,.028,.208);
    for(let i=0;i<2;i++)limb(leg,0xf9f6eb,[-.055,.16-hipY,(seated?.59:.16)+i*.04],[.055,.16-hipY,(seated?.59:.16)+i*.04],.009);
  }
  function arm(sign:number){const arm=new THREE.Group();arm.position.set(sign*.28,torsoY+.19,0);group.add(arm);oval(arm,p.jacket,sign*.025,-.07,0,.115,.16,.12);limb(arm,p.jacket,[sign*.035,-.08,0],[sign*.065,-.29,.045],.085);limb(arm,p.jacket,[sign*.065,-.29,.045],[sign*.07,-.45,.13],.074);oval(arm,p.shirt,sign*.07,-.44,.13,.077,.043,.073);oval(arm,p.skin,sign*.07,-.51,.15,.08,.1,.07);oval(arm,p.skin,sign*.025,-.5,.19,.034,.05,.035);return arm;}
  const leftArm=arm(-1),rightArm=arm(1);
  const cup=new THREE.Group();leftArm.add(cup);cup.position.set(-.07,-.52,.22);
  const mug=new THREE.Mesh(new THREE.CylinderGeometry(.085,.07,.16,20),material(style===2?0xf0e0be:0xd7e8df));cup.add(mug);
  const coffee=new THREE.Mesh(new THREE.CircleGeometry(.071,20),material(0x624333));coffee.rotation.x=-Math.PI/2;coffee.position.y=.081;cup.add(coffee);
  const handle=new THREE.Mesh(new THREE.TorusGeometry(.055,.016,6,16),material(0xd7e8df));handle.position.x=-.085;cup.add(handle);cup.visible=seated;
  return {group,head,arm:rightArm,leftArm,cup,animate(time:number,reviewing=false,walking=false){head.rotation.y=Math.sin(time*.33+style)*.18;head.rotation.z=Math.sin(time*.5+style)*.025;legGroups.forEach((leg,i)=>leg.rotation.x=walking&&!seated?Math.sin(time*8+i*Math.PI)*.32:0);leftArm.rotation.x=seated?-.65-Math.max(0,Math.sin(time*.35+style))*.8:-.12;rightArm.rotation.x=reviewing?-.8+Math.sin(time*5)*.13:seated?-.45+Math.sin(time*.6+style)*.08:-.2;}};
}
