import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { resources } from '@/shared/i18n';
import type { VisualState } from './visual';
import { announce, currentAction, placeLabel, type Action, type LabelBox } from './annotations';
type Translate = (key: keyof typeof resources['zh-CN']['office'], options?: { total: number | string }) => string;
import { taskAge, archiveTransfer, dispatchTransfer } from './simulation.mjs';
import { pendingInbox, dispatchDesk, archiveInbox, taskRug, loungeRug, carpetBinding, glassPartition, CHARACTER_SCALE, loungeSofas, loungeTables, sofaSeatOffsets, decisionTable, decisionChairs, dispatch, plants, desks, chairSeats, waitingSeats, waitingSeatRootY, coffeeStation, planter } from './navigation.mjs';
import { createHuman } from './humans';
import { createFoliage } from './foliage';
import { createChairGeometry } from './chairs';
import { binFrontBase, binFrontTop, binWidth, createBinShell, slotDepth, slotWidth, wellDepth } from './taskBin';
import {door,supplyPose,PREPARATION_SECONDS,ENTRY_SECONDS,SUPPLY_DROP_TIME} from './supply.mjs';

const C={floor:0x62666a,edge:0x414747,wood:0xb3b9d0,lightWood:0xd0d3e7,wall:0x535964,dark:0x272531,mint:0xaca6e5,white:0xdcdee8};
const drawingPixelBudget = 5_000_000;

export function createOffice(container:HTMLElement, labels:HTMLElement, sim:VisualState, onMember:(id:number)=>void, t: Translate){
  const scene=new THREE.Scene();
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.setClearColor(0x111322, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const zoneNames = [t('zone1'), t('zone2'), t('zone3'), t('zone4')];
  renderer.domElement.setAttribute('aria-label', [t('space'), ...zoneNames].join(' · '));
  renderer.domElement.setAttribute('role','img');container.append(renderer.domElement);
  const camera=new THREE.OrthographicCamera(-16,16,12,-12,.1,100);
  camera.position.set(23,25,29);camera.lookAt(0,.3,0);
  scene.add(new THREE.HemisphereLight(0xf2f5f3, 0x494b49, 2.4));
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.55);
  sun.position.set(-5, 17, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 15, bottom: -15, far: 45 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = .025;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xc4d4db, 1.4);
  fill.position.set(12, 8, -8);
  scene.add(fill);
  const root=new THREE.Group();scene.add(root);
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  function mat(color: number) {
    const existing = materials.get(color);
    if (existing) return existing;
    const material = new THREE.MeshStandardMaterial({ color, roughness: .75, metalness: .08 });
    materials.set(color, material);
    return material;
  }
  function box(w:number,h:number,d:number,x:number,y:number,z:number,color:number|THREE.Material, parent:THREE.Object3D=root, bevel=0){
    const geometry = bevel ? new RoundedBoxGeometry(w,h,d,1,bevel) : new THREE.BoxGeometry(w,h,d);
    const m=new THREE.Mesh(geometry,typeof color==='number'?mat(color):color);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  function cylinder(r:number,h:number,x:number,y:number,z:number,color:number,parent:THREE.Object3D=root,r2=r){const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r2,h,20),mat(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  function sphere(r:number,x:number,y:number,z:number,color:number,parent:THREE.Object3D=root){const m=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),mat(color));m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;}
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function floorPrint(canvas: HTMLCanvasElement, width: number, depth: number, x: number, y: number, z: number) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, y, z);
    root.add(plane);
    return texture;
  }
  box(23,.45,21,0,-.28,1,C.edge);box(22.6,.1,20.6,0,0,1,C.floor);
  // Mipmapped seams keep their coverage as the floor recedes toward the windows.
  const plankTile = document.createElement('canvas');
  plankTile.width = 256;
  plankTile.height = 512;
  const tile = plankTile.getContext('2d')!;
  tile.fillStyle = 'rgba(62,72,73,.17)';
  tile.fillRect(0, 0, 3, 512);
  tile.fillRect(128, 0, 3, 512);
  tile.fillRect(0, 0, 128, 3);
  tile.fillRect(128, 256, 128, 3);
  const grainPrint = floorPrint(plankTile, 22.4, 20.4, 0, .064, 1);
  grainPrint.wrapS = grainPrint.wrapT = THREE.RepeatWrapping;
  grainPrint.repeat.set(22.4 / 1.3, 20.4 / 2.5);
  // Build the wall around the three apertures so the reveals have real depth.
  const backWindows = [[-9.7, -2.05], [2.25, 9.85]];
  const sideWindow = [-1.85, 5.45];
  const sillY = .91, lintelY = 2.98;
  function wallSection(side: boolean, from: number, to: number, bottom = 0, top = 3.4) {
    const length = to - from, mid = (from + to) / 2;
    return box(side ? .2 : length, top - bottom, side ? length : .2,
      side ? -11.25 : mid, (bottom + top) / 2, side ? mid : -9.25, C.wall);
  }
  let last = -11.3;
  for (const [start, end] of backWindows) {
    wallSection(false, last, start);
    wallSection(false, start, end, 0, sillY);
    wallSection(false, start, end, lintelY);
    last = end;
  }
  wallSection(false, last, 11.3);
  for (const [start, end] of [[-9.25,-5.75],[-3.65,sideWindow[0]],
    [sideWindow[1],door.z-door.width/2],[door.z+door.width/2,11.25]]) wallSection(true, start, end);
  wallSection(true, sideWindow[0], sideWindow[1], 0, sillY);
  wallSection(true, sideWindow[0], sideWindow[1], lintelY);
  box(.18,.65,2.1,-11.25,3.075,-4.7,C.wall);box(.18,.8,door.width,door.x,3,door.z,C.wall);
  const doorFinish = 0x495263, doorPane = 0x97a4b5, casing = 0x969fae;
  const staffDoors = [-1,1].map(side => {
    const pivot = new THREE.Group();
    pivot.position.set(-11.25,.1,-4.7+side*1.05);
    root.add(pivot);
    box(.13,2.65,1.05,0,1.325,-side*.525,doorFinish,pivot,.036);
    box(.03,1.35,.72,.08,1.65,-side*.525,doorPane,pivot,.014);
    box(.09,.12,.09,.12,1.1,-side*.95,0xc2c8ce,pivot,.02);
    return pivot;
  });
  for(const z of [-5.8,-3.6])box(.25,2.85,.1,-11.25,1.43,z,casing,root,.036);
  box(.25,.12,2.3,-11.25,2.85,-4.7,casing,root,.036);
  const doorPivot=new THREE.Group();doorPivot.position.set(door.x,.1,door.z+door.width/2);root.add(doorPivot);
  box(.12,door.height,door.width,0,door.height/2,-door.width/2,doorFinish,doorPivot,.036);
  box(.025,1.25,.9,.075,1.55,-.85,doorPane,doorPivot,.012);
  box(.08,.1,.22,.12,1.12,-1.45,0xc2c8ce,doorPivot,.02);
  for(const z of [door.z-door.width/2,door.z+door.width/2])box(.28,2.7,.1,door.x,1.4,z,casing,root,.036);
  box(.28,.12,1.9,door.x,2.77,door.z,casing,root,.036);
  box(.4,.035,1.7,door.x,.11,door.z,0x8895a0,root,.015);
  box(22.6,.1,.22,0,3.42,-9.25,0x808a8c);box(.22,.1,20.6,-11.25,3.42,1,0x808a8c);
  box(22.3,.15,.2,0,.16,-9.1,0x343c3e);box(.2,.15,20.2,-11.1,.16,1,0x343c3e);
  const frostedGlass = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, dithering: true });
  function glazing(side: boolean, start: number, end: number, divisions: number[]) {
    const span = end - start, height = lintelY - sillY, mid = (end + start) / 2;
    const bay = new THREE.Group();
    bay.position.set(side ? -11.25 : mid, sillY, side ? mid : -9.25);
    bay.rotation.y = side ? Math.PI / 2 : 0;
    root.add(bay);
    // Diffuse daylight from the lintel down to the sill, baked into the pane vertices.
    const glassGeometry = new THREE.PlaneGeometry(span, height, 1, 2);
    const rows = side ? [0xacbabf, 0xa3b1b5, 0x7b8b93] : [0xb6c2c3, 0xacb8b9, 0x85959b];
    const colors = rows.flatMap(tint => {
      const { r, g, b } = new THREE.Color(tint);
      return [r, g, b, r, g, b];
    });
    glassGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const glass = new THREE.Mesh(glassGeometry, frostedGlass);
    glass.position.set(0, height / 2, -.095);
    bay.add(glass);
    const metal = 0x505b5e;
    for (const y of [.045, height - .045]) box(span, .09, .15, 0, y, .015, metal, bay,.022);
    for (const t of [0, ...divisions, 1]) {
      box(.078, height-.18, .15, (t - .5) * (span - .078), height / 2, .015, metal, bay,.018);
    }
    box(span + .14, .085, .34, 0, -.025, .09, 0x9ca4a1, bay,.032);
    // A partly lowered fabric blind adds depth without drawing stripes across the view.
    if (!side && start > 0) {
      const width = divisions[0] * span - .08, x = -span / 2 + width / 2 + .04;
      box(width, .4, .042, x, height - .21, .13, 0xc4c4b9, bay);
      box(width, .032, .055, x, height - .42, .13, metal, bay);
    }
  }
  for (const [start, end] of backWindows) glazing(false, start, end, [.38, .76]);
  glazing(true, sideWindow[0], sideWindow[1], [.46]);
  const carpetLeft = -10.4;
  const carpetBack = -8.35;
  const carpetFront = 9.35;
  // The shared aisle runs between work and dispatch on the left and the two rooms on the right.
  const carpets = [
    { ...taskRug, color: 0x535e62, labelZ: 8.8 },
    { left: carpetLeft, right: -.2, back: carpetBack, front: 3.35, color: 0x545b60, labelZ: 2.58 },
    { ...loungeRug, color: 0x67615b, labelZ: -1.12 },
    { left: 2.1, right: 10.4, back: .85, front: carpetFront, color: 0x535a5a, labelZ: 6.85 },
  ];
  const fixedFootprints = [...loungeSofas, coffeeStation, planter,
    { ...dispatchDesk, w: dispatchDesk.w - .55, d: .73 }];
  const carpetMarkMaterials = carpets.map(({ left, right, back, front, color, labelZ }, index) => {
    box(right - left, .035, front - back, (left + right) / 2, .09, (back + front) / 2, color);
    const width = right - left, depth = front - back;
    const border = document.createElement('canvas');
    border.width = border.height = 1024;
    const brush = border.getContext('2d')!;
    brush.scale(border.width / width, border.height / depth);
    // A quiet woven edge differentiates the carpet from the larger floor planks.
    brush.fillStyle = 'rgba(55,60,56,.052)';
    for (let z = 0; z < depth; z += .09) brush.fillRect(0, z, width, .016);
    // Bake contact shadows into the rug itself; these pieces never move.
    for (const {x,z,w,d} of fixedFootprints) {
      if (x < left || x > right || z < back || z > front) continue;
      brush.save();
      brush.fillStyle = 'rgba(32,37,38,.15)';
      brush.shadowColor = 'rgba(32,37,38,.25)';
      brush.shadowBlur = .16 * border.width / width;
      brush.beginPath();
      brush.roundRect(x-left-w/2+.035, z-back-d/2+.035, w-.07, d-.07, .09);
      brush.fill();
      brush.restore();
    }
    brush.beginPath();
    if (index === 2) {
      // The bottom rail finishes the lounge rug's front edge.
      brush.moveTo(carpetBinding, depth);
      brush.lineTo(carpetBinding, carpetBinding);
      brush.lineTo(width - carpetBinding, carpetBinding);
      brush.lineTo(width - carpetBinding, depth);
    } else {
      brush.rect(carpetBinding, carpetBinding, width - 2*carpetBinding, depth - 2*carpetBinding);
    }
    brush.lineJoin = 'round';
    brush.lineWidth = .078;
    brush.strokeStyle = 'rgba(40,48,50,.29)';
    brush.stroke();
    brush.lineWidth = .030;
    brush.strokeStyle = 'rgba(195,198,193,.53)';
    brush.stroke();
    floorPrint(border, width, depth, (left + right) / 2, .113, (back + front) / 2);

    const image = document.createElement('canvas');
    image.width = 1024;
    image.height = 256;
    const ink = image.getContext('2d')!;
    ink.fillStyle = '#283235';
    ink.strokeStyle = '#adb4b3';
    ink.lineWidth = 3.5;
    ink.font = '700 168px "PingFang SC", "Microsoft YaHei", sans-serif';
    ink.textAlign = 'center';
    ink.textBaseline = 'middle';
    ink.strokeText(zoneNames[index], 512, 136, 904);
    ink.fillText(zoneNames[index], 512, 136, 904);
    const texture = new THREE.CanvasTexture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .94, depthWrite: false, toneMapped: false });
    const printedName = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 1.25), material);
    printedName.rotation.x = -Math.PI / 2;
    printedName.position.set((left + right) / 2, .116, labelZ);
    root.add(printedName);
    return material;
  });
  // Glass screen separates the lounge while keeping the room visibly connected.
  const glass = new THREE.MeshBasicMaterial({ color: 0xa0bdc0, transparent: true, opacity: .12, depthWrite: false });
  const partition = glassPartition;
  const glassBase = .09 + .035 / 2;
  const frameHeight = 1.75, railHeight = .06;
  const paneHeight = frameHeight - 2 * railHeight;
  const pane = box(partition.w - 2 * partition.d, paneHeight, .025, partition.x, glassBase + railHeight + paneHeight / 2, partition.z, glass);
  pane.castShadow = false;
  for (const end of [-1, 1]) {
    const x = partition.x + end * (partition.w - partition.d) / 2;
    box(partition.d, frameHeight, partition.d, x, glassBase + frameHeight / 2, partition.z, 0x7c8a8b).castShadow = false;
  }
  for (const y of [glassBase + railHeight / 2, glassBase + frameHeight - railHeight / 2]) {
    box(partition.w, railHeight, partition.d, partition.x, y, partition.z, 0x7c8a8b).castShadow = false;
  }
  // The counter and its handoff points share the centre of the task rug.
  const { x: dx, z: dz, w: dw, d: dd } = dispatchDesk;
  box(dw, .18, dd, dx, 1.08, dz, 0xc2c2c3, root,.075);
  box(dw - .45, .93, .81, dx, .56, dz, 0x494a54, root,.048);
  box(dw - .55, .1, .73, dx, .16, dz, C.dark, root,.028);
  for (const offset of [-2.55, -.85, .85, 2.55]) {
    box(1.64, .65, .04, dx + offset, .6, dz + .42, 0x686972,root,.018);
    box(.29, .035, .04, dx + offset, .8, dz + .45, 0x94969e,root,.013);
  }
  const binMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78 });
  function taskBin(inbox: typeof pendingInbox, title: string, shell: number, face: string, accent: string) {
    const { x, z, slotY, slotZ } = inbox;
    const base = 1.17, height = slotY - base;
    const body = new THREE.Mesh(createBinShell(height, slotZ - z, shell), binMaterial);
    body.position.set(x, base, z);
    body.castShadow = body.receiveShadow = true;
    root.add(body);
    const lamp = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: .12 });
    box(slotWidth-.12, .012, .034, x, slotY+.027, slotZ+slotDepth/2+.025, lamp);

    const image = document.createElement('canvas');
    image.width = 1024; image.height = 384;
    const ink = image.getContext('2d')!;
    const texture = new THREE.CanvasTexture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(binWidth - .14, Math.hypot(height, binFrontBase - binFrontTop) - .065),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    plate.rotation.x = -Math.atan2(binFrontBase - binFrontTop, height);
    plate.position.set(x, base + height / 2 + .005, z + (binFrontBase + binFrontTop) / 2 + .01);
    root.add(plate);
    function print(total: number | null) {
      ink.fillStyle = face;
      ink.fillRect(0, 0, image.width, image.height);
      ink.fillStyle = accent;
      ink.fillRect(0, 0, 14, image.height);
      ink.fillStyle = '#ffffff';
      ink.textAlign = 'center'; ink.textBaseline = 'middle';
      ink.font = '650 136px "PingFang SC", "Microsoft YaHei", sans-serif';
      ink.fillText(title, 512, 111, 936);
      ink.font = '750 199px "PingFang SC", "Microsoft YaHei", sans-serif';
      ink.fillText(String(total ?? '—'), 512, 285, 936);
      texture.needsUpdate = true;
    }
    return { lamp, print, above: new THREE.Vector3(x, slotY+.14, slotZ), inside: new THREE.Vector3(x, slotY-wellDepth+.022, slotZ) };
  }
  const intake = taskBin(pendingInbox, t('intakeBin'), 0x42635f, '#234943', '#9fdfcf');
  const archive = taskBin(archiveInbox, t('deliveryBin'), 0x826949, '#58432c', '#efd098');
  function insertFile(file: THREE.Object3D, from: THREE.Vector3, bin: typeof intake, progress: number, scale: number) {
    const lift = THREE.MathUtils.smoothstep(progress, 0, .24);
    const reach = THREE.MathUtils.smoothstep(progress, .24, .72);
    const drop = THREE.MathUtils.smoothstep(progress, .72, 1);
    file.position.lerpVectors(from, bin.above, reach);
    file.position.y = THREE.MathUtils.lerp(from.y, bin.above.y, lift) + Math.sin(Math.PI * reach) * .12;
    file.position.lerp(bin.inside, drop);
    file.scale.setScalar(THREE.MathUtils.lerp(1, scale, reach));
  }
  const beltStart = pendingInbox.x + 1.12, beltLength = 2.03;
  const beltCentre = beltStart + beltLength / 2;
  box(beltLength,.13,.67,beltCentre,1.26,dz,0x252b40);
  const beltSlats=Array.from({length:18},(_,i)=>box(.045,.025,.61,beltStart+i*beltLength/18,1.34,dz,0x818da9));
  for(const z of [dz-.35,dz+.35])box(beltLength+.06,.09,.045,beltCentre,1.4,z,0x9aa9cb);
  const trayX = beltStart + beltLength + .23;
  box(.82,.055,.7,trayX,1.24,dz,0x353343);
  const readyPapers=Array.from({length:10},(_,i)=>box(.54,.025,.42,trayX+(i%2)*.025,1.28+.029*i,dz-(i%3)*.014,0xbdbcd5));
  const displays:{slot:number;screen:THREE.MeshStandardMaterial;bars:THREE.Mesh[];rows:THREE.Mesh[];cursor:THREE.Mesh}[]=[];
  function monitor(x:number,z:number,slot:number){
    const group=new THREE.Group();group.position.set(x,1.115,z);root.add(group);
    const graphite = 0x393b3d, metal = 0x66686a;
    box(.47,.042,.29,0,.021,-.01,metal,group,.02);
    const stand = box(.115,.48,.079,0,.262,-.076,metal,group,.019);
    stand.rotation.x = -.12;
    box(.27,.11,.10,0,.485,-.091,graphite,group,.03);
    box(.73,.40,.088,0,.622,-.056,metal,group,.042);
    box(1.05,.65,.065,0,.63,0,graphite,group,.029);
    const screen=new THREE.MeshStandardMaterial({color:0x12172d,emissive:0x3655a4,emissiveIntensity:.08,roughness:.45});box(.94,.54,.01,0,.64,.04,screen,group);
    const bars:THREE.Mesh[]=[],rows:THREE.Mesh[]=[];
    for(let i=0;i<4;i++)bars.push(box(.065,.1,.012,.12+i*.085,.51,.052,i%2?0x9e8aff:0x6da7ff,group));
    for(let i=0;i<5;i++)rows.push(box(.25+(i%3)*.035,.012,.012,-.24,.79-i*.065,.054,i%2?0x8c9bea:0xb0cfff,group));
    const cursor=box(.016,.035,.014,-.17,.53,.06,0xe1d7ff,group);
    displays.push({slot,screen,bars,rows,cursor});return group;
  }
  const chairMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .04 });
  function placeChair(geometry: THREE.BufferGeometry, x: number, z: number, facing: number) {
    const chair = new THREE.Mesh(geometry, chairMaterial);
    chair.position.set(x, 0, z);
    chair.rotation.y = facing;
    chair.castShadow = chair.receiveShadow = true;
    root.add(chair);
    return chair;
  }
  const workChairGeometry = createChairGeometry('work');
  // An empty chair opens toward the aisle while keeping its back clear of the desktop.
  const emptyChairAngle = 2 * Math.PI / 3;
  const workChairs: THREE.Mesh[] = [];
  for (const [x,z] of desks) {
    // Recessing the darker underside leaves a thin, readable edge at display scale.
    box(3.44,.065,1.44,x,1.016,z,0x757575,root,.025);
    box(3.5,.095,1.5,x,1.0675,z,0xb8b7b4,root,.043);
    for (const offset of [-1.45,1.45]) {
      for (const depth of [-.48,.48]) box(.09,.90,.09,x+offset,.557,z+depth,0x414345);
    }
    for (const seatX of [x-.65,x+.75]) {
      monitor(seatX, z-.3, workChairs.length);
      box(.55,.035,.19,seatX,1.1325,z+.32,0x414345,root,.014);
      workChairs.push(placeChair(workChairGeometry, seatX, z+1, emptyChairAngle));
    }
    cylinder(.085,.16,x+1.48,1.195,z+.22,0xafb4cc);
    box(.25,.015,.36,x-.05,1.123,z+.1,0xeee2bd);
  }
  // Upholstered seating is arranged in two rows by the windows.
  function surfaceTexture(fabric: boolean) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const ctx = tile.getContext('2d')!;
    ctx.fillStyle = '#fffcf7';
    ctx.fillRect(0, 0, 128, 128);
    // Keep the weave and grain below the contrast of the silhouette on a distant screen.
    ctx.strokeStyle = fabric ? '#e1ded8' : '#ded0bf';
    ctx.lineWidth = fabric ? 1.2 : 1.8;
    for (let i = 0; i < 128; i += fabric ? 8 : 16) {
      ctx.beginPath(); ctx.moveTo(0, i);
      if (fabric) {
        ctx.lineTo(128, i); ctx.moveTo(i, 0); ctx.lineTo(i, 128);
      } else ctx.bezierCurveTo(34, i + 4, 94, i - 4, 128, i);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(tile);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
  }
  const weave = surfaceTexture(true);
  const fabrics = new Map<number, THREE.MeshStandardMaterial>();
  function upholstery(w: number, h: number, d: number, x: number, y: number, z: number, color: number) {
    let fabric = fabrics.get(color);
    if (!fabric) {
      fabric = new THREE.MeshStandardMaterial({ color, map: weave, roughness: .96 });
      fabrics.set(color, fabric);
    }
    const cornerRadius = Math.max(w,d) >= 1 ? .12 : .09;
    const cushion = new THREE.Mesh(new RoundedBoxGeometry(w,h,d,2,cornerRadius),fabric);
    cushion.position.set(x, y, z);
    cushion.castShadow = true;
    cushion.receiveShadow = true;
    root.add(cushion);
    return cushion;
  }
  loungeSofas.forEach(({ x, z, w, d }, index) => {
    const frame = index % 2 === 0 ? 0x667d76 : 0x697c85;
    const fabric = index % 2 === 0 ? 0x8fa49a : 0x9aadb4;
    upholstery(w, .26, d, x, .34, z, frame);
    upholstery(w, .62, .28, x, .77, z - .37, frame);
    for (const side of [-1, 1]) {
      const armX = x + side * (w / 2 - .13);
      upholstery(.26, .45, d, armX, .57, z, frame);
      for (const footZ of [z - .31, z + .33]) box(.09, .13, .09, armX, .17, footZ, C.dark);
    }
    for (const offset of sofaSeatOffsets) {
      upholstery(.71, .14, .77, x + offset, .51, z + .115, fabric);
      upholstery(.71, .4, .15, x + offset, .79, z - .165, fabric);
    }
    const pillow = upholstery(.25, .29, .17, x + (index === 0 ? -.93 : .93), .76, z - .025, index === 0 ? 0xc99b77 : 0xa0afa3);
    pillow.rotation.z = index === 0 ? -.24 : .24;
  });
  loungeTables.forEach(({ x, z, r }, index) => {
    cylinder(r, .07, x, .48, z, 0xc2a48c);
    cylinder(.095, .39, x, .27, z, 0x746159);
    cylinder(.26, .04, x, .13, z, 0x746159);
    const magazine = box(.23, .025, .29, x - .08, .525, z, index === 0 ? 0x708a91 : 0xa89ab7);
    magazine.rotation.y = index === 0 ? .23 : -.3;
    cylinder(.068, .105, x + .18, .557, z + .05, 0xe2dfd6);
  });
  const {x:cx,z:cz,w:cw,d:cd}=coffeeStation;
  box(cw, 1.03, cd, cx, .55, cz, 0x766e68,root,.05);
  const oak = new THREE.MeshStandardMaterial({ color: 0xd4b18d, map: surfaceTexture(false), roughness: .78 });
  box(cw, .075, cd, cx, 1.1, cz, oak,root,.035);
  for (const offset of [-1.4, -.47, .47, 1.4]) {
    box(.89, .83, .04, cx + offset, .58, cz + cd / 2, oak,root,.019);
    box(.22, .036, .045, cx + offset, .89, cz + cd / 2 + .025, 0xae9e90,root,.015);
  }
  const barLight = new THREE.MeshStandardMaterial({color:0xd2b793,emissive:0xc99562,emissiveIntensity:.27});
  box(cw-.12,.035,.04,cx,1.035,cz+cd/2,barLight);
  const machineX = cx - 1;
  box(.76, .58, .5, machineX, 1.426, cz, C.dark);
  box(.56, .35, .025, machineX, 1.4, cz + .26, 0x191825);
  box(.18, .045, .08, machineX, 1.46, cz + .31, 0x9396ab);
  box(.52, .04, .23, machineX, 1.16, cz + .22, 0x7c7e98);
  box(.09, .035, .025, machineX + .19, 1.61, cz + .27, 0xa7a6d8);
  for (const offset of [-1, .12, .36, .6]) {
    cylinder(.07, .14, cx + offset, 1.225, cz + .22, 0xe2dfd6);
    cylinder(.05, .008, cx + offset, 1.296, cz + .22, 0x684b33);
  }
  cylinder(.15, .24, cx + 1.34, 1.25, cz, 0xaeb7c4);
  cylinder(.105, .12, cx + 1.34, 1.43, cz, 0xd4dce1);
  cylinder(.135, .045, cx + 1.34, 1.51, cz, 0x6e7d89);
  // Decision lounge with lounge chairs and a round table.
  const radius = decisionTable.r;
  const tabletopProfile = [
    [0,-.065], [radius-.028,-.065], [radius-.009,-.060], [radius,-.047],
    [radius,.040], [radius-.006,.054], [radius-.017,.063], [radius-.030,.065], [0,.065],
  ].map(([r,y]) => new THREE.Vector2(r,y));
  const tabletop = new THREE.Mesh(new THREE.LatheGeometry(tabletopProfile,64),mat(C.lightWood));
  tabletop.position.set(decisionTable.x,.78,decisionTable.z);
  tabletop.castShadow = tabletop.receiveShadow = true;
  root.add(tabletop);
  cylinder(.2,.72,decisionTable.x,.38,decisionTable.z,C.dark);
  const meetingChairGeometry = createChairGeometry('meeting');
  for (const [x,z] of decisionChairs) {
    placeChair(meetingChairGeometry, x, z, Math.atan2(decisionTable.x-x, decisionTable.z-z));
  }
  for(const [x,z] of [[decisionTable.x-.4,decisionTable.z+.1],[decisionTable.x+.5,decisionTable.z-.2]]){cylinder(.11,.18,x,.95,z,0xd7d5bd);cylinder(.08,.012,x,1.045,z,0x684b33);}
  const laptop = new THREE.Group();
  laptop.position.set(decisionTable.x + .18, .865, decisionTable.z + .34);
  laptop.rotation.y = -.42;
  root.add(laptop);
  box(.57,.035,.37,0,.02,0,0x666b81,laptop);
  box(.38,.011,.12,0,.045,-.015,0x3b3f53,laptop);
  const lid = new THREE.Group();
  lid.position.set(0,.035,-.17);
  lid.rotation.x = -.17;
  laptop.add(lid);
  box(.58,.36,.035,0,.18,0,0x34394d,lid);
  box(.51,.285,.012,0,.18,.024,0x586f9b,lid);
  box(.26,.035,.012,-.075,.23,.034,0xafc6cf,lid);
  const paperX = decisionTable.x - .1, paperZ = decisionTable.z - .15;
  box(.5,.025,.6,paperX,.88,paperZ,0xebe3c9);
  // Storage and acoustic vertical wooden slats.
  for(let i=0;i<12;i++)box(.07,2.6,.08,.2+i*.1,1.75,-9,0xc5ac83);
  const foliage = { upright: createFoliage(true), broad: createFoliage(false) };
  const leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .89, side: THREE.DoubleSide });
  function plantLeaves(habit: keyof typeof foliage, x: number, y: number, z: number, angle: number) {
    const leaves = new THREE.Mesh(foliage[habit], leafMaterial);
    leaves.position.set(x,y,z);
    leaves.rotation.y = angle;
    leaves.castShadow = leaves.receiveShadow = true;
    root.add(leaves);
    return leaves;
  }
  const rugTop = .09 + .035/2;
  plants.forEach(([x,z,s], index) => {
    const byWindow = z < -5;
    const h = (byWindow ? .53 : .36)*s, r = (byWindow ? .28 : .33)*s;
    cylinder(r,h,x,rugTop+h/2,z,0x767975,root,r*.78);
    cylinder(r*.88,.014,x,rugTop+h+.004,z,0x433e37);
    plantLeaves(byWindow ? 'upright' : 'broad', x,rugTop+h+.009,z,index*.92).scale.setScalar(s);
  });
  const soilY = rugTop + .34;
  box(planter.w,.34,planter.d,planter.x,rugTop+.17,planter.z,0x535957,root,.035);
  box(planter.w-.13,.018,planter.d-.12,planter.x,soilY+.004,planter.z,0x49443a,root,.008);
  // Three drifts leave pockets of exposed soil between their crowns.
  plantLeaves('broad',planter.x-1.06,soilY+.013,planter.z,.16).scale.set(1.36,.98,.51);
  plantLeaves('upright',planter.x-.04,soilY+.013,planter.z,-.20).scale.set(1.57,.93,.64);
  plantLeaves('broad',planter.x+1.04,soilY+.013,planter.z,-.12).scale.set(1.34,1.10,.52);
  // Only rigid furniture can share a draw call and a permanent shadow.
  const movingFurniture = new Set<THREE.Object3D>([doorPivot, ...staffDoors, ...workChairs,
    ...beltSlats, ...readyPapers, ...displays.flatMap(({ bars, rows, cursor }) => [...bars, ...rows, cursor])]);
  const furnitureBatches = new Map<string, THREE.Mesh[]>();
  const fixedFurniture = new Set<THREE.Mesh>();
  function collectFurniture(object: THREE.Object3D) {
    if (movingFurniture.has(object)) return;
    if (object instanceof THREE.Mesh) {
      fixedFurniture.add(object);
      if (object.material instanceof THREE.MeshStandardMaterial && !object.material.transparent) {
        const key = [object.material.uuid, object.castShadow, object.receiveShadow, !!object.geometry.index].join('/');
        const batch = furnitureBatches.get(key) ?? [];
        batch.push(object);
        furnitureBatches.set(key, batch);
      }
    }
    object.children.forEach(collectFurniture);
  }
  root.children.forEach(collectFurniture);
  // A file is physically carried by every messenger.
  const robots: ReturnType<typeof person>[] = [];
  function person(x:number,z:number,color:number){
    const group=new THREE.Group();group.position.set(x,.13,z);group.scale.setScalar(CHARACTER_SCALE);root.add(group);
    const body = new THREE.MeshStandardMaterial({color, roughness:.58});
    const torso = cylinder(.22,.48,0,.88,0,color,group,.27);torso.material=body;box(.38,.17,.25,0,.6,0,0x737290,group);
    const head=sphere(.21,0,1.35,0,0xd8d9e5,group);head.scale.set(.9,1.13,.9);
    {box(.33,.13,.06,0,1.36,.18,0x201b3c,group);for(const dx of [-.08,.08])box(.04,.035,.01,dx,1.37,.22,0xbbdedf,group);box(.09,.08,.02,0,.96,.24,0xd1dedf,group);}
    const legs=[],knees=[];for(const dx of [-.12,.12]){const leg=new THREE.Group();group.add(leg);leg.position.set(dx,.6,0);box(.14,.22,.16,0,-.11,0,0x9595ab,leg);const knee=new THREE.Group();leg.add(knee);knee.position.y=-.22;box(.13,.22,.15,0,-.11,0,0x9595ab,knee);box(.17,.12,.27,0,-.24,.05,0x343245,knee);legs.push(leg);knees.push(knee);}
    const arms=[];for(const dx of [-.3,.3]){const arm=new THREE.Group();group.add(arm);arm.position.set(dx,1.02,0);box(.12,.4,.13,0,-.17,0,body,arm);sphere(.075,0,-.39,.025,0xb0b1c3,arm);arms.push(arm);}
    const file=new THREE.Group();arms[1].add(file);file.position.set(0,-.25,.18);file.rotation.x=-.25;box(.36,.43,.035,0,0,0,0xe9dfbe,file);box(.27,.035,.008,0,.09,.025,color,file);for(let i=0;i<3;i++)box(.23-i*.04,.014,.008,-.02,.02-i*.055,.025,0x737190,file);file.visible=false;
    const ring=new THREE.Mesh(new THREE.RingGeometry(.34,.39,40),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.7,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.02;group.add(ring);
    return {body,group,left:legs[0],right:legs[1],knees,arm:arms[1],leftArm:arms[0],file,ring};
  }
  sim.agents.forEach(a=>robots.push(person(a.position[0],a.position[1],new THREE.Color(a.color).getHex())));
  const transferFile=robots[7].file.clone();root.add(transferFile);transferFile.visible=false;
  const preparationFile=transferFile.clone();root.add(preparationFile);preparationFile.visible=false;
  const supplyPile=new THREE.Group();root.add(supplyPile);for(let i=0;i<6;i++){box(.65,.045,.48,(i%2)*.02,i*.05,0,i%2?0xd6def3:0xeee4ce,supplyPile);}
  const resultPoint=archive.above;
  const resultFile=transferFile.clone();root.add(resultFile);resultFile.position.copy(resultPoint);resultFile.rotation.set(-Math.PI/2,0,0);resultFile.visible=false;
  const supervisor=createHuman(0);root.add(supervisor.group);supervisor.group.scale.setScalar(CHARACTER_SCALE);supervisor.group.position.set(dispatch.supervisor[0],.1,dispatch.supervisor[1]);supervisor.group.rotation.y=Math.PI;
  const manager = createHuman(1, true);
  root.add(manager.group);
  manager.group.scale.setScalar(CHARACTER_SCALE);
  const [chairX, chairZ] = decisionChairs[1];
  manager.group.position.set(chairX, .1, chairZ);
  manager.group.rotation.y = Math.atan2(decisionTable.x - chairX, decisionTable.z - chairZ) + .14;
  // Small stamp prop has a visible downstroke at approval and completion.
  const stamp=new THREE.Group();root.add(stamp);box(.27,.07,.23,0,0,0,0x762f32,stamp);cylinder(.065,.2,0,.13,0,0x6c5641,stamp);sphere(.1,0,.25,0,0x453d31,stamp);
  const completeStamp=stamp.clone();root.add(completeStamp);
  const seal=new THREE.Mesh(new THREE.RingGeometry(.11,.14,24),new THREE.MeshBasicMaterial({color:0x6f6c9f,side:THREE.DoubleSide}));seal.rotation.x=-Math.PI/2;seal.position.set(paperX,.9,paperZ);root.add(seal);
  const dotGeo=new THREE.SphereGeometry(.035,6,6);const particles:THREE.Mesh[]=[];for(let i=0;i<22;i++){const m=new THREE.Mesh(dotGeo,new THREE.MeshBasicMaterial({color:0xada9d7,transparent:true,opacity:.25}));m.position.set(Math.sin(i*7)*10,1+(i%5)*.8,Math.cos(i*3)*6);root.add(m);particles.push(m);}
  type Anchor = { el: HTMLElement; point: THREE.Vector3 };
  const anchors: Anchor[] = [];
  const sizes = new Map<Element, { w: number; h: number }>();
  const labelObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const size = entry.borderBoxSize[0];
      if (size?.inlineSize) sizes.set(entry.target, { w: size.inlineSize, h: size.blockSize });
    }
  });
  function label(className: string, text: string, point: THREE.Vector3) {
    const element = document.createElement(className === 'agent-label' ? 'button' : 'div');
    if (element instanceof HTMLButtonElement) element.type = 'button';
    element.className = className;
    element.textContent = text;
    labels.append(element);
    if (className !== 'agent-label') {
      anchors.push({ el: element, point });
      labelObserver.observe(element);
    }
    return element;
  }
  function selectMember(index: number) {
    const agent = sim.agents[index];
    const id = sim.mode === 'demo' ? agent.id : agent.memberId;
    if (id !== undefined && !['offline', 'exiting'].includes(agent.state)) onMember(id);
  }
  const robotLabels=robots.map((_,i)=>{
    const point = new THREE.Vector3();
    const el=label('agent-label','',point);
    const dot=document.createElement('i');
    const caption=document.createElement('span');
    el.append(dot,caption);
    el.addEventListener('click', () => selectMember(i));
    return {el,dot,caption,point};
  });
  const demoRoles = ['role0', 'role1', 'role2', 'role3', 'role4', 'role5', 'role6'] as const;
  const demoPhase = robots.map(() => '');
  const demoActions: Record<string, Action | undefined> = {
    assigned: 'cueClaim', working: 'cueWork', reviewing: 'cueReview', stamping: 'cueDeliver', idle: 'cueRest',
  };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const visibleRobots = robots.map(robot => robot.group);
  function pick(event: MouseEvent) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX-bounds.left)/bounds.width*2-1, 1-(event.clientY-bounds.top)/bounds.height*2);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(visibleRobots.filter(group => group.visible), true).at(0);
    for (let object: THREE.Object3D | null = hit?.object ?? null; object; object = object.parent) {
      const index = visibleRobots.indexOf(object as THREE.Group);
      if (index >= 0) { selectMember(index); return; }
    }
  }
  renderer.domElement.addEventListener('click', pick);
  const visitorPoint = new THREE.Vector3();
  const visitorLabel = label('visitor-label', t('visitorRequest'), visitorPoint);
  visitorLabel.style.display = 'none';
  const decisionLabel = label('decision-bubble', t('approved'), new THREE.Vector3(
    decisionTable.x + decisionTable.r, .15, decisionTable.z + decisionTable.r,
  ));
  decisionLabel.style.display = 'none';
  const completionLabel=label('completion-bubble',`✓ ${t('completed')}`,new THREE.Vector3(-6.2,2.3,3.9));completionLabel.style.display='none';
  anchors.find(a=>a.el===completionLabel)!.point.set(resultPoint.x,2.3,resultPoint.z);
  // Fit the actual mesh silhouette, rather than a fixed camera span that leaves
  // excess space below the office. Refit on resize without cropping the walls.
  root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const fittingPoints:THREE.Vector3[]=[];
  root.traverse(object=>{if(!(object instanceof THREE.Mesh))return;object.geometry.computeBoundingBox();const bounds=object.geometry.boundingBox!;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])fittingPoints.push(new THREE.Vector3(x,y,z).applyMatrix4(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse));
  });
  const fitted=new THREE.Box3().setFromPoints(fittingPoints);
  root.traverse(object => {
    if (object instanceof THREE.Mesh && !fixedFurniture.has(object)) object.castShadow = false;
  });
  for (const meshes of furnitureBatches.values()) {
    if (meshes.length < 2) continue;
    const parts = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    const geometry = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!geometry) continue;
    const first = meshes[0];
    const batch = new THREE.Mesh(geometry, first.material);
    batch.castShadow = first.castShadow;
    batch.receiveShadow = first.receiveShadow;
    root.add(batch);
    meshes.forEach(mesh => { mesh.removeFromParent(); mesh.geometry.dispose(); });
  }
  furnitureBatches.clear();
  fixedFurniture.clear();

  // A single draw places soft contact shadows under moving people.
  const people = [...robots.map(robot => robot.group), supervisor.group, manager.group];
  const shade = document.createElement('canvas');
  shade.width = shade.height = 64;
  const brush = shade.getContext('2d')!;
  const fade = brush.createRadialGradient(32, 32, 2, 32, 32, 32);
  fade.addColorStop(0, 'rgba(27, 25, 44, .38)');
  fade.addColorStop(1, 'rgba(27, 25, 44, 0)');
  brush.fillStyle = fade;
  brush.fillRect(0, 0, 64, 64);
  const contacts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.12, .85).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shade), transparent: true, depthWrite: false }), people.length);
  contacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  contacts.frustumCulled = false;
  root.add(contacts);
  const contactMatrix = new THREE.Matrix4();
  let viewportWidth = 0, viewportHeight = 0;
  let displayDensity = window.devicePixelRatio;
  const resize=()=>{const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;
    viewportWidth = w; viewportHeight = h;
    displayDensity = window.devicePixelRatio;
    const targetDensity = Math.min(2.5, Math.max(2, displayDensity * 1.25));
    const ratio = Math.min(targetDensity, Math.max(1, Math.sqrt(drawingPixelBudget / (w * h))));
    renderer.setDrawingBufferSize(w, h, ratio);
    const aspect=w/h;
    const marginX=w<600?12:10,marginY=h<500?14:10;
    const width=fitted.max.x-fitted.min.x,height=fitted.max.y-fitted.min.y;
    const span=Math.max(height*h/Math.max(1,h-2*marginY),width/aspect*w/Math.max(1,w-2*marginX));
    const fullscreen = container.closest('.awo')?.matches(':fullscreen, .awo--expanded');
    const lift = fullscreen ? 0 : Math.min(.55, Math.max(0, (span - height) / 4));
    const cx=(fitted.min.x+fitted.max.x)/2,cy=(fitted.min.y+fitted.max.y)/2 - lift;
    camera.left=cx-span*aspect/2;camera.right=cx+span*aspect/2;camera.top=cy+span/2;camera.bottom=cy-span/2;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  const v=new THREE.Vector3();
  const previousAngles=robots.map(()=>0);
  const zoneSeen=[...sim.zoneChanges];
  const zoneChangedAt = zoneSeen.map(() => -Infinity);
  const restoreShadows = () => { renderer.shadowMap.needsUpdate = true; };
  renderer.domElement.addEventListener('webglcontextrestored', restoreShadows);
  let lastPending: number | null | undefined, lastDone: number | null | undefined;
  let disposed=false;
  return {render(time:number){
    if(disposed)return;
    if (displayDensity !== window.devicePixelRatio) resize();
    const supply=supplyPose(sim.supplyTime ?? time),preparation=sim.preparation,inventory=sim.fileInventory;
    container.dataset.supply=supply.carrying?'carrying':supply.walking?'walking':'idle';
    container.dataset.preparation=preparation?'sorting':'idle';
    doorPivot.rotation.y+=((supply.doorOpen?-1.4:0)-doorPivot.rotation.y)*.12;
    staffDoors.forEach((pivot,i)=>pivot.rotation.y+=((sim.staffDoorOpen?(i?1:-1)*1.4:0)-pivot.rotation.y)*.12);
    if (lastPending !== sim.counts.pending || lastDone !== sim.counts.done) {
      if (lastPending !== sim.counts.pending) intake.print(sim.counts.pending);
      if (lastDone !== sim.counts.done) archive.print(sim.counts.done);
      lastPending = sim.counts.pending; lastDone = sim.counts.done;
      container.dataset.pending = String(lastPending); container.dataset.delivered = String(lastDone);
      renderer.domElement.setAttribute('aria-label', [t('space'), ...zoneNames,
        t('queueCount', { total: lastPending ?? '—' }), t('archivedCount', { total: lastDone ?? '—' })].join(' · '));
    }
    intake.lamp.emissiveIntensity = (sim.counts.pending ?? 0) > 0 ? .55 : .06;
    beltSlats.forEach((slat,i)=>slat.position.x=beltStart+((i*beltLength/18+(preparation?time*.7:0))%beltLength));
    readyPapers.forEach((paper,i)=>paper.visible=i<inventory.ready*3);
    const peerHandoff = sim.peerHandoff;
    const handoff = peerHandoff ?? sim.tasks.map(task=>dispatchTransfer(task,time)).find(Boolean);
    container.dataset.handoff = peerHandoff ? 'peer' : handoff ? (handoff.from === 7 ? 'outbound' : 'inbound') : 'idle';
    sim.zoneChanges.forEach((version, index) => {
      if (version !== zoneSeen[index]) {
        zoneSeen[index] = version;
        zoneChangedAt[index] = time;
      }
      carpetMarkMaterials[index].opacity = .94 + .06 * Math.max(0, 1 - (time - zoneChangedAt[index]) / 1.2);
    });
    robots.forEach((r,i)=>{const a=sim.agents[i];const sit=a.seatBlend;const seatedPoint=a.seatIndex===null?null:a.seatKind==='work'?chairSeats[a.seatIndex]:waitingSeats[a.seatIndex];
      const {el,dot,caption,point} = robotLabels[i];
      if (sim.mode === 'demo') {
        const phase = a.state === 'working' && a.route.length ? 'walking' : a.state;
        const action = demoActions[phase];
        if (demoPhase[i] && phase !== demoPhase[i] && action) announce(a, action, time);
        demoPhase[i] = phase;
      }
      const cue = currentAction(a, time);
      const title = i === 7 ? t('chiefName') : sim.mode === 'demo'
        ? t(demoRoles[(i < 7 ? i : i - 1) % demoRoles.length]) : a.role || a.name;
      const text = cue ? t(cue) : title;
      if (caption.textContent !== text) caption.textContent = text;
      if (el.dataset.action !== (cue ?? '')) el.dataset.action = cue ?? '';
      const accessibleName = cue ? title + ' · ' + text : title;
      if (el.getAttribute('aria-label') !== accessibleName) el.setAttribute('aria-label', accessibleName);
      if (el.dataset.role !== title) el.dataset.role = title;
      if(dot.dataset.color!==a.color){dot.style.background=a.color;dot.dataset.color=a.color;r.body.color.set(a.color);r.ring.material.color.set(a.color);}
      r.group.visible = a.state !== 'offline';
      el.style.display = r.group.visible && a.state !== 'exiting' ? '' : 'none';
      r.group.position.x=a.position[0]+((seatedPoint?.[0]??a.position[0])-a.position[0])*sit;r.group.position.z=a.position[1]+((seatedPoint?.[1]??a.position[1])-a.position[1])*sit;const moving=a.route.length>0&&sit===0;
      if(moving){const d=a.route[0];const angle=Math.atan2(d[0]-a.position[0],d[1]-a.position[1]);previousAngles[i]=angle;r.group.rotation.y=angle;}else{
        const atTaskDesk=dispatch.pickups.some(([x,z])=>Math.hypot(x-a.position[0],z-a.position[1])<.1);
        const discussing = a.state === 'reviewing' || a.state === 'decision';
        const facing=discussing?Math.atan2(manager.group.position.x-a.position[0], manager.group.position.z-a.position[1]):i===7?Math.PI:sit>0?(a.seatKind==='work'?Math.PI:0):atTaskDesk?0:previousAngles[i];
        r.group.rotation.y=facing+Math.sin(time*.2+i)*.035;
      }
      const gait=moving?Math.sin(a.walk*12)*.45:0;r.left.rotation.x=gait-Math.PI/2*sit;r.right.rotation.x=-gait-Math.PI/2*sit;r.knees.forEach(knee=>knee.rotation.x=Math.PI/2*sit);r.group.position.y=.13+(a.seatKind==='waiting'?waitingSeatRootY-.13:0)*sit+(moving?Math.abs(Math.sin(a.walk*12))*.035:Math.sin(time*1.7+i)*.008);
      const currentTask=sim.tasks.find(task=>task.id===a.taskId);
      const age=currentTask?taskAge(currentTask,time):0;
      const received=currentTask&&age>=(currentTask.agents[0]===i?5.8:7.6);
      r.file.visible=(a.state==='receiving'&&!!received)||['decision','reviewing','resuming','delivering'].includes(a.state)||(a.state==='stamping'&&age<66);
      const typing=a.state==='working'&&sit>.5;r.arm.rotation.x=r.file.visible?-.65:typing?-.85+Math.sin(time*5)*.08:-.2*sit;r.leftArm.rotation.x=typing?-.85+Math.sin(time*5+1)*.08:-.2*sit;r.ring.visible=a.state!=='idle'&&sit<.1;
      if (cue) r.ring.visible = true;
      if (r.group.visible && a.state !== 'exiting') {
        // The label follows its owner. Nearby walkers and changing captions cannot move it.
        point.set(r.group.position.x, 1.83, r.group.position.z).project(camera);
        const seat = a.seatIndex ?? 0;
        const lift = a.seatKind === 'work' ? (1 - seat % 2) * 13 : a.seatKind === 'waiting' ? (2 - seat % 3) * 9 : 0;
        const x = Math.round((point.x * .5 + .5) * viewportWidth);
        const y = Math.round((-point.y * .5 + .5) * viewportHeight - lift * sit);
        el.style.left = x + 'px';
        el.style.top = y + 'px';
      }
      el.classList.toggle('busy', !['idle','dispatching','unknown'].includes(a.state));
    });
    displays.forEach((display,index)=>{
      const active=sim.agents.some(a=>a.seatKind==='work'&&a.seatIndex===display.slot&&a.seatBlend>.2);
      display.screen.emissiveIntensity=active?.55+Math.sin(time*1.5+index)*.08:.035;
      display.bars.forEach((bar,j)=>{bar.visible=active;const h=active?.65+(Math.sin(time*(1+j*.2)+j+index)+1)*.85:.35;bar.scale.y=h;bar.position.y=.47+.05*h;});
      display.rows.forEach((row,j)=>{row.scale.x=active?.45+((time*.38+j*.23+index*.1)%1)*.55:.5;row.visible=active;});
      display.cursor.visible=active&&Math.sin(time*4)>0;display.cursor.position.x=-.36+((time*.15)% .27);
    });
    workChairs.forEach((chair, index) => {
      const occupant = sim.agents.find(a => a.seatKind === 'work' && a.seatIndex === index && a.seatBlend > 0);
      chair.rotation.y = THREE.MathUtils.lerp(emptyChairAngle, Math.PI, occupant?.seatBlend ?? 0);
    });
    const participant = sim.agents.find(a => (a.state === 'reviewing' || a.state === 'decision') && !a.route.length);
    const review=sim.tasks.find(task=>task.state==='reviewing');const stamping=sim.tasks.find(task=>task.state==='stamping'&&taskAge(task,time)>=67.8&&taskAge(task,time)<68.8);
    const archiving=sim.tasks.map(task=>archiveTransfer(task,time)).find(Boolean);container.dataset.archiving=archiving?'depositing':'idle';
    stamp.position.set(paperX,1.12-Math.max(0,Math.sin(time*6))*.15,paperZ);stamp.visible=sim.mode==='demo'&&!!review;
    completeStamp.position.set(resultPoint.x,1.98-Math.max(0,Math.sin(time*7))*.2,resultPoint.z);completeStamp.visible=!!stamping;
    decisionLabel.style.display = review || participant ? 'block' : 'none';
    if (review || participant) {
      const rejected = !!review?.rejected;
      decisionLabel.textContent = t(sim.mode === 'live' ? 'approval' : rejected ? 'rejected' : 'approved');
      decisionLabel.classList.toggle('rejected', rejected);
      (seal.material as THREE.MeshBasicMaterial).color.set(rejected ? 0xd18b7b : 0x6f6c9f);
    }
    seal.visible=sim.mode==='demo'&&!!review;completionLabel.style.display=stamping?'block':'none';
    supervisor.group.visible=supply.visible;supervisor.group.position.set(supply.position[0],.1+(supply.walking?Math.abs(Math.sin(time*8))*.015:0),supply.position[1]);
    visitorLabel.style.display = sim.mode === 'live' && supply.visible && !supply.leaving ? '' : 'none';
    visitorPoint.set(supply.position[0], 2.3, supply.position[1]);
    supervisor.group.rotation.y=supply.walking?supply.heading:Math.PI;
    supervisor.animate(time,false,supply.walking);
    manager.animate(time, !!review || !!participant);
    if (participant) {
      const direction = Math.atan2(participant.position[0] - chairX, participant.position[1] - chairZ);
      manager.head.rotation.y += THREE.MathUtils.clamp(direction - manager.group.rotation.y, -.55, .55);
    } else {
      manager.head.rotation.y += .50;
    }
    supplyPile.visible=supply.visible&&supply.carrying;
    if(supplyPile.visible){supervisor.arm.rotation.x=supervisor.leftArm.rotation.x=-1.05;supervisor.group.updateMatrixWorld(true);
      const held=supervisor.group.localToWorld(new THREE.Vector3(0,1.05,.4));const u=supply.phase>ENTRY_SECONDS?(supply.phase-ENTRY_SECONDS)/(SUPPLY_DROP_TIME-ENTRY_SECONDS):0;
      insertFile(supplyPile, held, intake, u, .38);
      supplyPile.rotation.y=supervisor.group.rotation.y;
    }
    robots[7].arm.rotation.x=-.35;
    transferFile.visible=!!handoff;
    if(handoff){
      const from=robots[handoff.from],to=robots[handoff.to],u=Math.max(0,Math.min(1,handoff.progress)),eased=u*u*(3-2*u);
      from.arm.rotation.x=-1.1;to.arm.rotation.x=-1.1;from.file.visible=false;to.file.visible=false;
      from.group.rotation.y=Math.atan2(to.group.position.x-from.group.position.x,to.group.position.z-from.group.position.z);
      to.group.rotation.y=Math.atan2(from.group.position.x-to.group.position.x,from.group.position.z-to.group.position.z);
      const start=from.file.getWorldPosition(new THREE.Vector3()),end=to.file.getWorldPosition(new THREE.Vector3());
      transferFile.position.lerpVectors(start,end,eased);transferFile.position.y+=Math.sin(Math.PI*u)*.65;
      transferFile.rotation.set(-.2-Math.sin(Math.PI*u)*.65,from.group.rotation.y+(to.group.rotation.y-from.group.rotation.y)*eased,0);
    }
    const deposit = sim.previewDeposit;
    archive.lamp.emissiveIntensity = Math.sin(Math.PI * (deposit?.progress ?? archiving?.progress ?? 0));
    robots[7].file.visible=false;resultFile.visible=!!archiving || !!deposit;
    resultFile.position.copy(resultPoint);resultFile.rotation.set(-Math.PI/2,0,0);resultFile.scale.setScalar(1);
    if(archiving){
      const age=66+archiving.progress*4,courier=robots[archiving.from];
      courier.group.rotation.y=0;courier.arm.rotation.x=stamping?-.8-Math.sin(time*7)*.25:-1.1;courier.file.visible=false;
      courier.group.updateMatrixWorld(true);const held=courier.file.getWorldPosition(new THREE.Vector3());
      if(age<67.8){insertFile(resultFile, held, archive, .72*(age-66)/1.8, 1);}
      else if(age>=68.8){const drop=(age-68.8)/1.2;resultFile.position.lerp(archive.inside,drop);resultFile.scale.setScalar(1-.65*Math.min(1,drop*3));}
    }
    if (deposit) {
      const courier = robots[deposit.from];
      courier.file.visible = false;
      const start = courier.file.getWorldPosition(v);
      const u = deposit.progress;
      insertFile(resultFile, start, archive, u, .42);
    }
    preparationFile.visible=false;
    if(preparation){
      const u=(time-preparation.readyAt+PREPARATION_SECONDS)/PREPARATION_SECONDS;
      preparationFile.visible=true;preparationFile.position.set(beltStart+u*beltLength,1.4,dz);preparationFile.rotation.set(-Math.PI/2,0,0);
    }
    particles.forEach((p,i)=>{p.position.y=1+(i%5)*.8+Math.sin(time*.5+i)*.14;});
    const obstacles: LabelBox[] = [];
    const faceRadius = Math.max(5, viewportHeight / (camera.top - camera.bottom) * .26);
    for (const person of people) {
      if (!person.visible) continue;
      const headY = person === manager.group ? manager.head.position.y :
        person === supervisor.group ? supervisor.head.position.y : 1.35;
      v.set(person.position.x, person.position.y + headY * CHARACTER_SCALE, person.position.z).project(camera);
      obstacles.push({ x: (v.x * .5 + .5) * viewportWidth - faceRadius, y: (-v.y * .5 + .5) * viewportHeight - faceRadius,
        w: faceRadius * 2, h: faceRadius * 2 });
    }
    for (const { el, point } of anchors) {
      if (el.style.display === 'none') continue;
      const size = sizes.get(el);
      if (!size) { el.style.visibility = 'hidden'; continue; }
      v.copy(point).project(camera);
      const x = (v.x * .5 + .5) * viewportWidth, y = (-v.y * .5 + .5) * viewportHeight;
      const box = placeLabel(el === decisionLabel ? x + size.w / 2 : x, el === decisionLabel ? y + size.h + 3 : y,
        size.w, size.h, viewportWidth, viewportHeight, obstacles);
      el.style.visibility = box ? '' : 'hidden';
      if (!box) continue;
      obstacles.push(box);
      el.style.left = Math.round(box.x) + 'px';
      el.style.top = Math.round(box.y) + 'px';
    }
    contacts.count = 0;
    for (const person of people) {
      if (person.visible) contacts.setMatrixAt(contacts.count++, contactMatrix.makeTranslation(person.position.x, .119, person.position.z));
    }
    contacts.instanceMatrix.needsUpdate = true;
    renderer.render(scene,camera);
  },dispose(){disposed=true;observer.disconnect();labelObserver.disconnect();contacts.dispose();sun.shadow.dispose();renderer.domElement.removeEventListener('webglcontextrestored',restoreShadows);renderer.domElement.removeEventListener('click',pick);labels.replaceChildren();const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();scene.traverse(obj=>{if(obj instanceof THREE.Mesh||obj instanceof THREE.Line){geometries.add(obj.geometry);const ms=Array.isArray(obj.material)?obj.material:[obj.material];ms.forEach(m=>{materials.add(m);Object.values(m).forEach(value=>{if(value instanceof THREE.Texture)textures.add(value);});});}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();}};
}
