type RGB = [number, number, number];

/**
 * The scene behind the glass: one flat field of the accent colour. The glass
 * tint on top keeps text readable, and Glass translucency sets how much of the
 * colour comes through.
 */
export function paintWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number, accent: RGB) {
  ctx.fillStyle = `rgb(${accent.join(",")})`;
  ctx.fillRect(0, 0, w, h);
}

// The renderer compiles shaders and paints once; reload fully in dev rather than patch it live.
import.meta.hot?.accept(() => location.reload());
