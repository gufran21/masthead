export const VERTEX_SHADER = "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}";

/**
 * One full-window pass. Top-level glass (window, float) refracts the wallpaper;
 * nested glass (tile, accent, soft) refracts the glass under it. Frost comes from
 * two pre-blurred copies of the wallpaper, so each pixel needs only a few reads.
 */
export const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D uS;
uniform sampler2D uB1;
uniform sampler2D uB2;
uniform vec2 uRes;
uniform float uDpr;
uniform vec4 uR[48];
uniform vec4 uK[48];
uniform int uN;
uniform vec3 uA;
uniform float uRefr;
uniform float uTint;
uniform float uSolid;
// Light themes: light glass, softer shadows, whiter tiles.
uniform float uLight;
uniform vec3 uGlass;

float sdB(vec2 p, vec4 r, float rad) {
  rad = min(rad, min(r.z, r.w));
  vec2 q = abs(p - r.xy) - r.zw + rad;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
}
vec3 tx(sampler2D s, vec2 p) { return texture2D(s, clamp(p / uRes, 0.001, 0.999)).rgb; }
vec2 nrm(vec2 p, vec4 r, float rad) {
  vec2 g = vec2(sdB(p + vec2(1.0, 0.0), r, rad) - sdB(p - vec2(1.0, 0.0), r, rad),
                sdB(p + vec2(0.0, 1.0), r, rad) - sdB(p - vec2(0.0, 1.0), r, rad));
  return g / max(length(g), 0.0001);
}
// An even, fixed rim of light around each glass edge: no gradient, nothing follows the cursor.
vec3 spec(float e) {
  float rim = 1.0 - smoothstep(0.0, 2.0, e);
  return vec3(0.38) * rim;
}
vec3 topCol(vec2 q, vec4 r, vec4 k, float heavy) {
  float d = sdB(q, r, k.x);
  float e = max(-d, 0.0);
  vec2 n = nrm(q, r, k.x);
  float W = 26.0;
  float x = clamp(1.0 - e / W, 0.0, 1.0);
  float bend = x * x * (3.0 - 2.0 * x) * x;
  vec2 off = -n * bend * uRefr * (1.0 - uSolid);
  vec3 c;
  c.r = mix(tx(uB1, q + off * 0.94).r, tx(uB2, q + off * 0.94).r, heavy);
  c.g = mix(tx(uB1, q + off).g, tx(uB2, q + off).g, heavy);
  c.b = mix(tx(uB1, q + off * 1.08).b, tx(uB2, q + off * 1.08).b, heavy);
  float t = k.y > 2.5 ? uTint * 0.9 : uTint;
  t = mix(t, 0.94, uSolid);
  c = mix(c, uGlass, t);
  return c + spec(e);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec3 col = tx(uS, p);
  float sh = 100000.0;
  float dT = 100000.0; vec4 rT = vec4(0.0); vec4 kT = vec4(0.0); float hasT = 0.0;
  float dN = 100000.0; vec4 rN = vec4(0.0); vec4 kN = vec4(0.0); float hasN = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= uN) break;
    vec4 r = uR[i];
    vec4 k = uK[i];
    float d = sdB(p, r, k.x);
    bool top = k.y < 0.5 || (k.y > 2.5 && k.y < 3.5);
    if (top) {
      sh = min(sh, sdB(p - vec2(0.0, 18.0), r, k.x));
      if (d < 1.0) { dT = d; rT = r; kT = k; hasT = 1.0; }
    } else if (d < 1.0) { dN = d; rN = r; kN = k; hasN = 1.0; }
  }
  col *= 1.0 - mix(0.42, 0.14, uLight) * (1.0 - smoothstep(-20.0, 56.0, sh));
  if (hasT > 0.5) col = mix(col, topCol(p, rT, kT, 0.0), clamp(0.5 - dT, 0.0, 1.0));
  if (hasN > 0.5) {
    float e = max(-dN, 0.0);
    vec2 n = nrm(p, rN, kN.x);
    float W = max(4.0, min(16.0, min(rN.z, rN.w)));
    float x = clamp(1.0 - e / W, 0.0, 1.0);
    float bend = x * x * (3.0 - 2.0 * x) * x;
    vec2 off = -n * bend * uRefr * 0.55 * (1.0 - uSolid);
    vec3 g = hasT > 0.5 ? topCol(p + off, rT, kT, 1.0) : tx(uB2, p + off);
    if (kN.y < 1.5) g = mix(g, vec3(1.0), mix(0.06, 0.5, uLight));
    else if (kN.y < 2.5) g = mix(g, uA, 0.80);
    else g = mix(g, uA, 0.26);
    g += spec(e) * 0.9;
    col = mix(col, g, clamp(0.5 - dN, 0.0, 1.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// The renderer compiles shaders and paints once; reload fully in dev rather than patch it live.
import.meta.hot?.accept(() => location.reload());
