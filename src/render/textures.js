import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Soft round sprites, generated once and shared.
//
// Everything here is a radial gradient on a small canvas. They exist because
// hard-edged quads read as *geometry* rather than light: a flat coloured plane
// under a car looks like a blue slab stuck to the chassis, and a square particle
// looks like confetti. With a smooth alpha falloff the same quad reads as a pool
// of light, a contact shadow, or a spark.
// ---------------------------------------------------------------------------

const cache = new Map();

function canvasTexture(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  if (ctx) draw(ctx, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Paint a radial gradient, tolerating a canvas that cannot make one. Headless
 * runs (and the odd locked-down browser) hand back a stub 2D context; falling
 * back to the innermost colour keeps the game running instead of throwing from
 * inside mesh construction.
 */
function gradient(ctx, size, stops) {
  let g = null;
  try {
    g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  } catch (e) {
    g = null;
  }
  if (!g || typeof g.addColorStop !== 'function') {
    ctx.fillStyle = stops[0][1];
    ctx.fillRect(0, 0, size, size);
    return false;
  }
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return true;
}

const radial = gradient;

/**
 * A plain soft shadow: dark in the middle, nothing at the edge. Used under the
 * ball (where it doubles as a landing indicator for aerials) and for any blob
 * shadow that should not carry a team colour.
 */
export function shadowTexture() {
  if (!cache.has('shadow')) {
    cache.set(
      'shadow',
      canvasTexture(128, (ctx, s) =>
        radial(ctx, s, [
          [0, 'rgba(0,0,0,0.55)'],
          [0.35, 'rgba(0,0,0,0.34)'],
          [0.62, 'rgba(0,0,0,0.14)'],
          [0.85, 'rgba(0,0,0,0.03)'],
          [1, 'rgba(0,0,0,0)'],
        ])
      )
    );
  }
  return cache.get('shadow');
}

/**
 * The car's ground blob: a dark contact core fading into a white halo. The
 * material's colour tints the halo (white × team colour), while the black core
 * stays black — so one quad gives both the contact shadow and the team glow,
 * with normal blending and no additive wash-out on bright floors.
 */
export function carBlobTexture() {
  if (!cache.has('carBlob')) {
    cache.set(
      'carBlob',
      canvasTexture(128, (ctx, s) => {
        // alpha: shadow core, then the glow ring, then nothing
        radial(ctx, s, [
          [0, 'rgba(0,0,0,0.62)'],
          [0.2, 'rgba(0,0,0,0.42)'],
          [0.34, 'rgba(0,0,0,0.16)'],
          [0.44, 'rgba(255,255,255,0.05)'],
          [0.56, 'rgba(255,255,255,0.3)'],
          [0.74, 'rgba(255,255,255,0.16)'],
          [0.9, 'rgba(255,255,255,0.03)'],
          [1, 'rgba(255,255,255,0)'],
        ]);
        // colour: black core -> white ring, painted over the alpha above
        ctx.globalCompositeOperation = 'source-atop';
        gradient(ctx, s, [
          [0, 'rgba(0,0,0,1)'],
          [0.4, 'rgba(0,0,0,1)'],
          [0.55, 'rgba(255,255,255,1)'],
          [1, 'rgba(255,255,255,1)'],
        ]);
        ctx.globalCompositeOperation = 'source-over';
      })
    );
  }
  return cache.get('carBlob');
}

/**
 * A round spark/soft particle sprite. Replaces square points, which look like
 * confetti against a stadium floor.
 */
export function sparkTexture() {
  if (!cache.has('spark')) {
    cache.set(
      'spark',
      canvasTexture(64, (ctx, s) =>
        radial(ctx, s, [
          [0, 'rgba(255,255,255,1)'],
          [0.25, 'rgba(255,255,255,0.75)'],
          [0.55, 'rgba(255,255,255,0.22)'],
          [0.8, 'rgba(255,255,255,0.04)'],
          [1, 'rgba(255,255,255,0)'],
        ])
      )
    );
  }
  return cache.get('spark');
}

/** Release every cached texture (renderer teardown / quality reset). */
export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
