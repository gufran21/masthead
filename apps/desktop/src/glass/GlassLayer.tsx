import { useEffect, useRef, type RefObject } from "react";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shaders";
import { paintWallpaper } from "./wallpaper";

/**
 * Liquid-glass renderer. Every element under `root` tagged with
 * `data-glass="window | tile | accent | float | soft"` is drawn as refracting
 * glass in one WebGL pass behind the HTML. Text stays crisp HTML on top.
 * It redraws only when the layout or a setting changes.
 */
export interface GlassOptions {
  accent: string;
  /** 0–100: higher shows more of what is behind the glass. */
  translucency: number;
  /** Solid surfaces instead of glass (Reduce transparency). */
  solid: boolean;
  refraction: number;
}

const KINDS: Record<string, number> = { window: 0, tile: 1, accent: 2, float: 3, soft: 4 };
const MAX = 48;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function GlassLayer({ root, options }: { root: RefObject<HTMLElement | null>; options: GlassOptions }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const opts = useRef(options);
  const repaint = useRef<() => void>(() => {});
  const dirty = useRef(true);

  useEffect(() => {
    const accentChanged = opts.current.accent !== options.accent;
    opts.current = options;
    if (accentChanged) repaint.current();
    dirty.current = true;
  }, [options]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = root.current;
    if (!canvas || !host) return;
    const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attr = gl.getAttribLocation(program, "a");
    gl.enableVertexAttribArray(attr);
    gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);

    const names = ["uS", "uB1", "uB2", "uRes", "uDpr", "uR", "uK", "uN", "uA", "uRefr", "uTint", "uSolid"];
    const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
    const textures = [0, 1, 2].map(() => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    });

    let w = 0;
    let h = 0;
    let dpr = 1;
    const rects = new Float32Array(MAX * 4);
    const kinds = new Float32Array(MAX * 4);
    let count = 0;
    let signature = "";

    const paintAll = () => {
      if (!w) return;
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      const make = () => Object.assign(document.createElement("canvas"), { width: W, height: H });
      const sharp = make();
      const sctx = sharp.getContext("2d")!;
      sctx.scale(dpr, dpr);
      paintWallpaper(sctx, w, h, rgb(opts.current.accent));
      const blurred = [12, 30].map((r) => {
        const c = make();
        const x = c.getContext("2d")!;
        x.fillStyle = "#090B14";
        x.fillRect(0, 0, W, H);
        x.filter = `blur(${Math.round(r * dpr)}px)`;
        x.drawImage(sharp, -r * dpr, -r * dpr, W + 2 * r * dpr, H + 2 * r * dpr);
        return c;
      });
      [sharp, ...blurred].forEach((c, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, textures[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      });
      dirty.current = true;
    };
    repaint.current = paintAll;

    const resize = () => {
      const nw = host.offsetWidth || 1;
      const nh = host.offsetHeight || 1;
      let nd = Math.min(2, window.devicePixelRatio || 1);
      if (nw * nh * nd * nd > 7_000_000) nd = Math.sqrt(7_000_000 / (nw * nh));
      if (nw === w && nh === h && nd === dpr) return;
      w = nw;
      h = nh;
      dpr = nd;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      paintAll();
    };

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const scale = hostRect.width / (host.offsetWidth || hostRect.width || 1);
      const els = host.querySelectorAll<HTMLElement>("[data-glass]");
      let n = 0;
      let sig = "";
      for (let i = 0; i < els.length && n < MAX; i++) {
        const el = els[i];
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const kind = KINDS[el.dataset.glass ?? ""] ?? 1;
        const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        const o = n * 4;
        rects[o] = (r.left - hostRect.left + r.width / 2) / scale;
        rects[o + 1] = (r.top - hostRect.top + r.height / 2) / scale;
        rects[o + 2] = r.width / 2 / scale;
        rects[o + 3] = r.height / 2 / scale;
        kinds[o] = radius;
        kinds[o + 1] = kind;
        sig += `${rects[o] | 0},${rects[o + 1] | 0},${rects[o + 2] | 0},${rects[o + 3] | 0},${kind};`;
        n++;
      }
      count = n;
      if (sig !== signature) {
        signature = sig;
        dirty.current = true;
      }
    };

    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!w) return;
      measure();
      if (!dirty.current) return;
      dirty.current = false;
      const o = opts.current;
      gl.viewport(0, 0, canvas.width, canvas.height);
      textures.forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.uniform1i(u.uS, 0);
      gl.uniform1i(u.uB1, 1);
      gl.uniform1i(u.uB2, 2);
      gl.uniform2f(u.uRes, w, h);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform4fv(u.uR, rects);
      gl.uniform4fv(u.uK, kinds);
      gl.uniform1i(u.uN, count);
      const [r, g, b] = rgb(o.accent);
      gl.uniform3f(u.uA, r / 255, g / 255, b / 255);
      gl.uniform1f(u.uRefr, o.refraction);
      // Dark tint behind text: about 52% at the default translucency of 70.
      gl.uniform1f(u.uTint, 0.37 + ((100 - o.translucency) / 100) * 0.5);
      gl.uniform1f(u.uSolid, o.solid ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    host.setAttribute("data-gl", "on");
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    document.fonts?.ready.then(paintAll);
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      host.removeAttribute("data-gl");
      repaint.current = () => {};
    };
  }, [root]);

  return <canvas ref={canvasRef} className="glass-canvas" aria-hidden="true" />;
}
