/**
 * Liquid glass for the notch island, drawn with WebGL2 over a capture of the
 * screen behind the window: frosted, bent at the edges like a lens, tinted dark
 * enough for white text and finished with a flat, even rim. A new capture fades
 * in over the old one, so the backdrop never jumps.
 */

const FADE_MS = 260;

export interface Backdrop {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Island bounds in CSS pixels, top-left origin. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBack0;
uniform sampler2D uBack1;
uniform float uMix;      // cross-fade from uBack0 to uBack1
uniform float uHasBack;
uniform vec2 uRes;       // canvas size, device pixels
uniform vec4 uRect;      // island x, y, width, height, device pixels, top-left origin
uniform float uRadius;
uniform float uAlpha;
uniform float uDpr;
out vec4 outColor;

float box(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 frost(sampler2D t, vec2 uv) {
  vec2 texel = 1.0 / vec2(textureSize(t, 0));
  vec3 c = vec3(0.0);
  float total = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 o = vec2(float(x), float(y));
      float w = exp(-dot(o, o) / 4.5);
      c += textureLod(t, uv + o * texel * 6.0, 3.0).rgb * w;
      total += w;
    }
  }
  return c / total;
}

vec3 backdrop(vec2 uv) {
  vec3 c = frost(uBack0, uv);
  if (uMix > 0.0) c = mix(c, frost(uBack1, uv), uMix);
  return c;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 half_ = uRect.zw * 0.5;
  vec2 p = frag - (uRect.xy + half_);
  float r = min(uRadius, min(half_.x, half_.y));
  float d = box(p, half_, r);

  // A soft shadow just below, so the island separates from light windows.
  float shadow = 0.24 * (1.0 - smoothstep(-2.0 * uDpr, 12.0 * uDpr, box(p - vec2(0.0, 3.0 * uDpr), half_, r)));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  if (inside <= 0.0 && shadow <= 0.0) { outColor = vec4(0.0); return; }

  vec3 col = vec3(0.07, 0.075, 0.09);
  float tint = 0.6;
  if (uHasBack > 0.5) {
    // Lens: near the edge, sample from further inside, as thick glass bends light.
    float band = min(16.0 * uDpr, min(half_.x, half_.y));
    float bend = pow(1.0 - clamp(-d / band, 0.0, 1.0), 2.0);
    vec2 e = vec2(1.0, 0.0);
    vec2 n = normalize(vec2(box(p + e.xy, half_, r) - box(p - e.xy, half_, r),
                            box(p + e.yx, half_, r) - box(p - e.yx, half_, r)) + 1e-6);
    col = backdrop((frag - n * bend * band * 0.9) / uRes);
    // A little extra colour, so what's behind reads through the tint.
    float grey = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = clamp(mix(vec3(grey), col, 1.35), 0.0, 1.0);
    // One tint for the whole island, darker over bright backdrops, so text stays readable.
    vec3 avg = textureLod(uBack0, (uRect.xy + half_) / uRes, 6.0).rgb;
    tint = mix(0.42, 0.78, smoothstep(0.35, 0.95, dot(avg, vec3(0.2126, 0.7152, 0.0722))));
  }
  col = mix(col, vec3(0.04, 0.045, 0.06), tint);
  col += vec3(0.3) * (1.0 - smoothstep(0.0, 1.2 * uDpr, -d)); // flat rim

  float a = inside * uAlpha;
  float s = shadow * uAlpha * (1.0 - a);
  outColor = vec4(col * a, a + s);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "compile failed");
  return shader;
}

export class NotchGlass {
  private readonly tex: [WebGLTexture, WebGLTexture];
  private readonly u: Record<string, WebGLUniformLocation | null> = {};
  private front = 0;
  private hasBack = false;
  private fadeStart = -1;
  private lost = false;

  /** Returns null when WebGL2 isn't available; the island then falls back to CSS. */
  static create(canvas: HTMLCanvasElement, width: number, height: number, onLost: () => void): NotchGlass | null {
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) return null;
    try {
      return new NotchGlass(canvas, gl, width, height, onLost);
    } catch {
      return null;
    }
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    width: number,
    height: number,
    onLost: () => void,
  ) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      onLost();
    });

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    gl.useProgram(prog);
    for (const name of ["uBack0", "uBack1", "uMix", "uHasBack", "uRes", "uRect", "uRadius", "uAlpha", "uDpr"]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
    gl.uniform1i(this.u.uBack0, 0);
    gl.uniform1i(this.u.uBack1, 1);

    // One triangle that covers the canvas.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const texture = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tex = [texture(), texture()];
  }

  /** True while a new capture is fading in, so the caller keeps drawing frames. */
  get fading(): boolean {
    return this.fadeStart >= 0;
  }

  setBackdrop(b: Backdrop): void {
    if (this.lost) return;
    const gl = this.gl;
    if (this.fading) {
      this.front = 1 - this.front;
      this.fadeStart = -1;
    }
    const slot = this.hasBack ? 1 - this.front : this.front;
    gl.bindTexture(gl.TEXTURE_2D, this.tex[slot]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, b.width, b.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, b.pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (this.hasBack) this.fadeStart = performance.now();
    this.hasBack = true;
  }

  draw(rect: Rect, radius: number, alpha: number): void {
    if (this.lost) return;
    const gl = this.gl;
    let mix = 0;
    if (this.fading) {
      mix = Math.min((performance.now() - this.fadeStart) / FADE_MS, 1);
      if (mix >= 1) {
        this.front = 1 - this.front;
        this.fadeStart = -1;
        mix = 0;
      }
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (alpha <= 0.001 || rect.w < 1 || rect.h < 1) return;

    const d = this.canvas.width / parseFloat(this.canvas.style.width);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.front]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[1 - this.front]);
    gl.uniform1f(this.u.uMix, mix);
    gl.uniform1f(this.u.uHasBack, this.hasBack ? 1 : 0);
    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.u.uRect, rect.x * d, rect.y * d, rect.w * d, rect.h * d);
    gl.uniform1f(this.u.uRadius, radius * d);
    gl.uniform1f(this.u.uAlpha, alpha);
    gl.uniform1f(this.u.uDpr, d);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
