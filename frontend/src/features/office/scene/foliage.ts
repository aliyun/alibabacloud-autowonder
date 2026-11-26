import * as THREE from 'three';

// Each leaf grows from a narrow stem, folds along its midrib and tapers to a point.
// The same two static meshes serve the window pots and the foreground planter.
export function createFoliage(upright: boolean) {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const greens = [0x556e58, 0x70836a, 0x62795f, 0x809076];
  const count = upright ? 9 : 11;
  for (let leaf = 0; leaf < count; leaf++) {
    const angle = leaf * 2.4, dx = Math.sin(angle), dz = Math.cos(angle);
    const inner = leaf / (count - 1);
    const length = (upright ? .79 : .47) + inner * .27 + .10 * Math.sin(leaf * 2);
    const reach = (upright ? .30 : .46) * (1 - .65*inner);
    const width = upright ? .087 : .14;
    const color = new THREE.Color(greens[leaf % greens.length]);
    const base = positions.length / 3;
    for (let row = 0; row <= 5; row++) {
      const t = row / 5, blade = Math.sin(Math.PI*t);
      const radius = .025 + .07*(1-inner) + reach * t**1.35;
      const y = upright ? length*t : length*(.62*t + .50*Math.sin(Math.PI*.86*t));
      const halfWidth = .002 + width * blade;
      for (const edge of [-1, 0, 1]) {
        positions.push(dx*radius + dz*edge*halfWidth, y + (edge === 0 ? .033*blade : 0),
          dz*radius - dx*edge*halfWidth);
        const value = .77 + .23*t + (edge === 0 ? .10 : .035*edge);
        colors.push(color.r*value, color.g*value, color.b*value);
      }
      if (row === 5) continue;
      const a = base + 3*row;
      indices.push(a,a+3,a+1, a+1,a+3,a+4, a+1,a+4,a+2, a+2,a+4,a+5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
