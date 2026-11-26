import * as THREE from 'three';

export const binWidth = 2.27, binRear = -.48, binFrontTop = .26, binFrontBase = .7;
export const slotWidth = 1.46, slotDepth = .34, wellDepth = .22;

// Join successive horizontal contours into one shell, from the sloped sign face
// over the metal lip and down into the pocket that receives the document.
export function createBinShell(height: number, slotZ: number, shell: number) {
  type Point = [number, number, number];
  function contour(halfWidth: number, back: number, front: number, y: number, corner: number): Point[] {
    const w = halfWidth, c = corner;
    const points: Point[] = [];
    for (const [x,z,start] of [[-w+c,front-c,Math.PI], [w-c,front-c,Math.PI/2],
      [w-c,back+c,0], [-w+c,back+c,-Math.PI/2]]) {
      for (let step = 0; step <= 4; step++) {
        const angle = start - step*Math.PI/8;
        points.push([x+c*Math.cos(angle), y, z+c*Math.sin(angle)]);
      }
    }
    return points;
  }
  const positions: number[] = [], colors: number[] = [];
  const body = new THREE.Color(shell);
  const trim = body.clone().lerp(new THREE.Color(0xb9b9b5), .27);
  function triangle(a: Point, b: Point, c: Point, color: THREE.Color) {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  }
  const w = binWidth / 2, halfSlot = slotWidth / 2, back = slotZ - slotDepth / 2, front = slotZ + slotDepth / 2;
  let ring = contour(w, binRear, binFrontBase, 0, .065);
  function band(next: Point[], color: THREE.Color) {
    ring.forEach((p, i) => {
      const j = (i + 1) % ring.length;
      triangle(p, ring[j], next[j], color);
      triangle(p, next[j], next[i], color);
    });
    ring = next;
  }
  band(contour(w, binRear, binFrontTop, height, .065), body);
  band(contour(w-.023, binRear+.023, binFrontTop-.023, height+.018, .054), trim);
  band(contour(halfSlot+.045, back-.045, front+.045, height+.018, .085), body);
  band(contour(halfSlot, back, front, height+.026, .052), trim);
  const bottom = height - wellDepth;
  band(contour(halfSlot-.025, back+.015, front-.015, bottom, .025), new THREE.Color(0x363b3c));
  const floor = new THREE.Color(0x202427);
  ring.forEach((p, i) => triangle([0,bottom,slotZ], p, ring[(i+1)%ring.length], floor));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
