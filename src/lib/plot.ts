/** HTML5 Canvas 2D 极简绘图引擎：发丝网格、精确刻度、等宽数字标签。 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Scale = ((v: number) => number) & { d0: number; d1: number; r0: number; r1: number };

export const INK = '#0f172a';
export const SUB = '#334155';
export const MUTED = '#64748b';
export const HAIR = '#e2e8f0';
export const GRID = '#eef2f7';
export const ACCENT = '#2563eb';
export const WARN = '#d97706';
export const TRACE = '#94a3b8';

export function makeScale(d0: number, d1: number, r0: number, r1: number): Scale {
  const span = d1 - d0 || 1;
  const f = ((v: number) => r0 + ((v - d0) / span) * (r1 - r0)) as Scale;
  f.d0 = d0;
  f.d1 = d1;
  f.r0 = r0;
  f.r1 = r1;
  return f;
}



export function niceStep(span: number, target: number): number {
  const rough = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const norm = rough / mag;
  let mult = 1;
  if (norm >= 7) mult = 10;
  else if (norm >= 3) mult = 5;
  else if (norm >= 1.5) mult = 2;
  return mult * mag;
}

export function ticksFor(min: number, max: number, target: number): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const step = niceStep(max - min, target);
  const start = Math.ceil(min / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    if (out.length > 40) break;
  }
  return out;
}

export function tickLabel(v: number, step: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1).replace('e+', 'e');
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)) + 0);
  return v.toFixed(decimals);
}

export function mono(ctx: CanvasRenderingContext2D, size = 9, weight = 400) {
  ctx.font = `${weight} ${size}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
}

export function sans(ctx: CanvasRenderingContext2D, size = 10, weight = 400) {
  ctx.font = `${weight} ${size}px -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
}

export type AxisOptions = {
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel?: string;
  yLabel?: string;
  xTickCount?: number;
  yTickCount?: number;
  xTicks?: number[];
  yTicks?: number[];
  hideY?: boolean;
  title?: string;
  titleSub?: string;
  zeroLine?: boolean;
};

export type Axes = {
  rect: Rect;
  xs: Scale;
  ys: Scale;
  xTicks: number[];
  yTicks: number[];
};

export function drawAxes(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  opts: AxisOptions,
): Axes {
  const [x0, x1] = opts.xDomain;
  const [y0, y1] = opts.yDomain;
  const xs = makeScale(x0, x1, rect.x, rect.x + rect.w);
  const ys = makeScale(y0, y1, rect.y + rect.h, rect.y);
  const xt = opts.xTicks ?? ticksFor(x0, x1, opts.xTickCount ?? 6);
  const yt = opts.yTicks ?? ticksFor(y0, y1, opts.yTickCount ?? 4);

  ctx.save();
  ctx.lineWidth = 0.8;
  ctx.setLineDash([2, 3]);
  ctx.strokeStyle = GRID;
  ctx.beginPath();
  for (const t of xt) {
    const px = Math.round(xs(t)) + 0.5;
    ctx.moveTo(px, rect.y);
    ctx.lineTo(px, rect.y + rect.h);
  }
  for (const t of yt) {
    const py = Math.round(ys(t)) + 0.5;
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.w, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // 零线加强
  if (opts.zeroLine !== false && y0 < 0 && y1 > 0) {
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    const py = Math.round(ys(0)) + 0.5;
    ctx.moveTo(rect.x, py);
    ctx.lineTo(rect.x + rect.w, py);
    ctx.stroke();
  }

  // 边框
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

  // 刻度标签
  const xStep = xt.length > 1 ? Math.abs(xt[1] - xt[0]) : 1;
  const yStep = yt.length > 1 ? Math.abs(yt[1] - yt[0]) : 1;
  mono(ctx, 8.5);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'center';
  for (const t of xt) {
    ctx.fillText(tickLabel(t, xStep), xs(t), rect.y + rect.h + 12);
  }
  if (!opts.hideY) {
    ctx.textAlign = 'right';
    for (const t of yt) {
      ctx.fillText(tickLabel(t, yStep), rect.x - 6, ys(t) + 3);
    }
  }

  // 轴标题
  sans(ctx, 9.5);
  ctx.fillStyle = SUB;
  if (opts.xLabel) {
    ctx.textAlign = 'right';
    ctx.fillText(opts.xLabel, rect.x + rect.w, rect.y + rect.h + 26);
  }
  if (opts.yLabel && !opts.hideY) {
    ctx.save();
      // 旋转后沿纵轴居中：局部 +x 方向指向屏幕上方，故用居中对齐避免越出画布
      ctx.translate(Math.max(10, rect.x - 26), rect.y + rect.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(opts.yLabel, 0, 0);
      ctx.restore();
    }
  if (opts.title) {
    sans(ctx, 10, 600);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, rect.x, rect.y - 7);
    if (opts.titleSub) {
      mono(ctx, 8.5);
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'right';
      ctx.fillText(opts.titleSub, rect.x + rect.w, rect.y - 7);
    }
  }
  ctx.restore();
  return { rect, xs, ys, xTicks: xt, yTicks: yt };
}

export type SeriesStyle = {
  color?: string;
  width?: number;
  dash?: number[];
  alpha?: number;
};

export function drawSeries(
  ctx: CanvasRenderingContext2D,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xs: Scale,
  ys: Scale,
  style: SeriesStyle = {},
) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(xs.r0, ys.r1, xs.r1 - xs.r0, ys.r0 - ys.r1);
  ctx.clip();
  ctx.strokeStyle = style.color ?? ACCENT;
  ctx.lineWidth = style.width ?? 1.2;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.lineJoin = 'round';
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < n; i++) {
    const v = y[i];
    if (!isFinite(v)) {
      started = false;
      continue;
    }
    const px = xs(x[i]);
    const py = ys(v);
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else ctx.lineTo(px, py);
  }
  ctx.stroke();
    ctx.restore();
  }

  export function drawBars(
  ctx: CanvasRenderingContext2D,
  centers: ArrayLike<number>,
  values: ArrayLike<number>,
  binWidth: number,
  xs: Scale,
  ys: Scale,
  opts: { fill?: string; stroke?: string; alpha?: number } = {},
) {
  const n = Math.min(centers.length, values.length);
  ctx.save();
  ctx.beginPath();
  ctx.rect(xs.r0, ys.r1, xs.r1 - xs.r0, ys.r0 - ys.r1);
  ctx.clip();
  ctx.fillStyle = opts.fill ?? '#dbeafe';
  ctx.strokeStyle = opts.stroke ?? '#93c5fd';
  ctx.lineWidth = 0.8;
  ctx.globalAlpha = opts.alpha ?? 1;
  const base = ys(Math.max(ys.d0, 0));
  for (let i = 0; i < n; i++) {
    const left = xs(centers[i] - binWidth / 2);
    const right = xs(centers[i] + binWidth / 2);
    const top = ys(values[i]);
    const w = Math.max(0.6, right - left - 0.4);
    const h = base - top;
    if (h <= 0.2) continue;
    ctx.fillRect(left + 0.2, top, w, h);
    ctx.strokeRect(left + 0.2, top, w, h);
  }
  ctx.restore();
}

export function drawFill(
  ctx: CanvasRenderingContext2D,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  xs: Scale,
  ys: Scale,
  opts: { fill?: string; alpha?: number; base?: number } = {},
) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return;
  const baseV = opts.base ?? 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(xs.r0, ys.r1, xs.r1 - xs.r0, ys.r0 - ys.r1);
  ctx.clip();
  ctx.globalAlpha = opts.alpha ?? 0.18;
  ctx.fillStyle = opts.fill ?? ACCENT;
  ctx.beginPath();
  ctx.moveTo(xs(x[0]), ys(baseV));
  for (let i = 0; i < n; i++) ctx.lineTo(xs(x[i]), ys(y[i]));
  ctx.lineTo(xs(x[n - 1]), ys(baseV));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 曲线在横轴上的竖线标记（例如 t0 集合切片） */
export function drawVLine(
  ctx: CanvasRenderingContext2D,
  xValue: number,
  xs: Scale,
  ys: Scale,
  opts: { color?: string; dash?: number[]; label?: string } = {},
) {
  const px = Math.round(xs(xValue)) + 0.5;
  ctx.save();
  ctx.strokeStyle = opts.color ?? WARN;
  ctx.lineWidth = 1;
  ctx.setLineDash(opts.dash ?? [3, 3]);
  ctx.beginPath();
  ctx.moveTo(px, ys.r1);
  ctx.lineTo(px, ys.r0);
  ctx.stroke();
  ctx.setLineDash([]);
  if (opts.label) {
    mono(ctx, 8.5);
    ctx.fillStyle = opts.color ?? WARN;
    ctx.textAlign = 'left';
    ctx.fillText(opts.label, px + 4, ys.r1 + 10);
  }
  ctx.restore();
}

export function drawHLine(
  ctx: CanvasRenderingContext2D,
  yValue: number,
  xs: Scale,
  ys: Scale,
  opts: { color?: string; dash?: number[]; width?: number } = {},
) {
  const py = Math.round(ys(yValue)) + 0.5;
  ctx.save();
  ctx.strokeStyle = opts.color ?? WARN;
  ctx.lineWidth = opts.width ?? 1;
  ctx.setLineDash(opts.dash ?? [4, 3]);
  ctx.beginPath();
  ctx.moveTo(xs.r0, py);
  ctx.lineTo(xs.r1, py);
  ctx.stroke();
  ctx.restore();
}



