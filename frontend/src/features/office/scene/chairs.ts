import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Point = [number, number, number];

// Each style is built once. Its parts share a single draw even when a desk chair swivels.
export function createChairGeometry(style: 'work' | 'meeting') {
  const parts: THREE.BufferGeometry[] = [];
  function add(shape: THREE.BufferGeometry, tint: number, x: number, y: number, z: number) {
    const part = shape.index ? shape.toNonIndexed() : shape;
    if (part !== shape) shape.dispose();
    part.translate(x, y, z);
    part.deleteAttribute('uv');
    const color = new THREE.Color(tint);
    const rgb = new THREE.Float32BufferAttribute(new Float32Array(part.attributes.position.count * 3), 3);
    for (let i = 0; i < rgb.count; i++) rgb.setXYZ(i, color.r, color.g, color.b);
    part.setAttribute('color', rgb);
    parts.push(part);
  }
  function pad(w: number, h: number, d: number, radius: number) {
    return new RoundedBoxGeometry(w, h, d, 1, radius);
  }
  function backrest(w: number, h: number, d: number, wrap: number) {
    const shape = pad(w, h, d, .055);
    const { position, normal } = shape.attributes;
    const n = new THREE.Vector3();
    const curvature = wrap / ((w / 2) ** 2);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      position.setZ(i, position.getZ(i) + curvature * x * x);
      n.fromBufferAttribute(normal, i);
      n.x -= 2 * curvature * x * n.z;
      n.normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
    return shape.rotateX(-.13);
  }
  function strut(from: Point, to: Point, bottomRadius: number, topRadius: number, tint: number) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const axis = b.clone().sub(a);
    const shape = new THREE.CylinderGeometry(topRadius, bottomRadius, axis.length(), 8);
    shape.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    const mid = a.lerp(b, .5);
    add(shape, tint, mid.x, mid.y, mid.z);
  }

  const graphite = 0x353638;
  if (style === 'work') {
    // The seat top meets the bent thighs; the back ends below the robot's head.
    add(pad(.66, .13, .60, .06), 0x535456, 0, .56, .015);
    add(backrest(.66, .46, .085, .070), graphite, 0, .90, -.29);
    add(backrest(.60, .40, .075, .055), 0x696a6b, 0, .91, -.252);
    add(pad(.085, .36, .072, .025).rotateX(-.15), graphite, 0, .69, -.32);
    add(backrest(.45, .085, .055, .027), 0x727374, 0, .82, -.34);
    for (const side of [-1, 1]) {
      strut([side * .29, .53, -.06], [side * .355, .79, -.04], .029, .024, graphite);
      add(pad(.083, .055, .32, .025), graphite, side * .355, .80, .015);
    }
    strut([0, .20, 0], [0, .54, 0], .058, .040, 0x606163);
    for (let i = 0; i < 5; i++) {
      const angle = i * 2 * Math.PI / 5;
      const x = .326 * Math.sin(angle), z = .326 * Math.cos(angle);
      strut([0, .23, 0], [x, .173, z], .045, .029, graphite);
      const caster = new THREE.CylinderGeometry(.052, .052, .064, 10);
      caster.rotateZ(Math.PI / 2).rotateY(angle);
      add(caster, 0x272729, x, .163, z);
    }
  } else {
    // A low upholstered shell leaves the seated decision maker's face and gestures visible.
    add(pad(.69, .13, .59, .065), 0x898784, 0, .523, .005);
    add(backrest(.72, .40, .115, .095), 0x706e6c, 0, .737, -.263);
    add(backrest(.65, .34, .072, .072), 0x979592, 0, .75, -.214);
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        strut([x * .29, .111, z * .24], [x * .225, .51, z * .18], .026, .045, 0x565553);
      }
    }
  }
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  return geometry;
}
