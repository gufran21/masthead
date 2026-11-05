type RGB = [number, number, number];

const shade = (c: RGB, f: number) =>
  `rgb(${c.map((v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))).join(",")})`;

/**
 * The scene behind the glass. Crisp shapes (orbs, rings, a dot grid) give the
 * refraction something to bend; the main orb follows the accent colour.
 */
export function paintWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number, accent: RGB) {
  const m = Math.min(w, h);
  ctx.fillStyle = "#090B14";
  ctx.fillRect(0, 0, w, h);

  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  const orb = (x: number, y: number, r: number, light: string, mid: string, dark: string) => {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, light);
    g.addColorStop(0.55, mid);
    g.addColorStop(1, dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  };

  // Bright shapes stay away from the title bar and sidebar labels.
  glow(w * 0.3, h * 0.85, m * 0.9, `rgba(${accent.join(",")},0.26)`);
  glow(w * 0.88, h * 0.8, m * 0.9, "rgba(110,92,255,0.34)");

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1.2;
  for (let r = 80; r < Math.max(w, h) * 1.2; r += 54) {
    ctx.beginPath();
    ctx.arc(w * 0.52, h * 0.58, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let y = 13; y < h; y += 26) for (let x = 13; x < w; x += 26) ctx.fillRect(x, y, 1.6, 1.6);

  orb(w * 0.24, h * 0.92, m * 0.3, shade(accent, 0.5), shade(accent, -0.05), shade(accent, -0.7));
  orb(w * 0.9, h * 0.88, m * 0.38, "#A99CF5", "#5E4FE0", "#1A1152");
  orb(w * 0.68, h * 0.5, m * 0.1, "#F2A6BC", "#E04672", "#5C0D27");
  orb(w * 0.5, h * 1.02, m * 0.08, "#A8EBD3", "#27B88B", "#0A3F32");

  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 26;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(w * (0.2 + i * 0.22), -40);
    ctx.lineTo(w * (0.0 + i * 0.22), h + 40);
    ctx.stroke();
  }
  ctx.restore();
}
