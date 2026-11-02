/** 基础统计与分布函数（闭式解）。 */



/** Abramowitz & Stegun 7.1.26，最大绝对误差 1.5e-7 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

export function normalCdf(x: number, mu = 0, sigma = 1): number {
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

export function normalPdf(x: number, mu = 0, sigma = 1): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/** 一阶贝塞尔函数 I0（级数展开） */
export function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const y = (x * x) / 4;
  for (let k = 1; k < 300; k++) {
    term *= y / (k * k);
    sum += term;
    if (term < sum * 1e-13) break;
  }
  return sum;
}

/**
 * 指数缩放贝塞尔函数 I0e(x) = e^{−|x|}·I0(x)。
 * 小参数用级数，大参数（x ≥ 18）用渐近展开，避免 I0 溢出导致 Inf/NaN。
 */
export function besselI0e(x: number): number {
  const ax = Math.abs(x);
  if (ax < 18) return besselI0(x) * Math.exp(-ax);
  // I0(x) ~ e^x/√(2πx) · (1 + 1/(8x) + 9/(128x²) + 225/(3072x³))
  const inv = 1 / ax;
  const series = 1 + inv / 8 + (9 * inv * inv) / 128 + (225 * inv * inv * inv) / 3072;
  return series / Math.sqrt(2 * Math.PI * ax);
}

/** I1e(x) = e^{−|x|}·I1(x)，渐近展开用于大参数 */
export function besselI1e(x: number): number {
  const ax = Math.abs(x);
  const sign = x < 0 ? -1 : 1;
  if (ax < 18) return besselI1(x) * Math.exp(-ax);
  // I1(x) ~ e^x/√(2πx) · (1 − 3/(8x) + 15/(128x²) − 105/(1024x³))
  const inv = 1 / ax;
  const series = 1 - (3 * inv) / 8 + (15 * inv * inv) / 128 - (105 * inv * inv * inv) / 1024;
  return sign * series / Math.sqrt(2 * Math.PI * ax);
}

/** 一阶贝塞尔函数 I1（级数展开） */
export function besselI1(x: number): number {
  let sum = 0;
  let term = x / 2;
  const y = (x * x) / 4;
  for (let k = 1; k < 300; k++) {
    sum += term;
    term *= y / (k * (k + 1));
    if (Math.abs(term) < Math.abs(sum) * 1e-13) break;
  }
  return sum;
}

/**
 * Laguerre L_{1/2}(x)。用缩放贝塞尔函数重写以保持数值稳定：
 *   L_{1/2}(−K) = (1+K)·I0e(K/2) + K·I1e(K/2)
 */
export function laguerreHalf(x: number): number {
  const K = -x;
  if (K <= 0) return 1;
  const h = K / 2;
  return (1 + K) * besselI0e(h) + K * besselI1e(h);
}

/** 莱斯包络的一阶矩（K = 0 时退化为瑞利 σ√(π/2)） */
export function riceMean(sigma: number, a: number): number {
  if (a <= 0) return sigma * Math.sqrt(Math.PI / 2);
  const K = (a * a) / (2 * sigma * sigma);
  return sigma * Math.sqrt(Math.PI / 2) * laguerreHalf(-K);
}

export function rayleighPdf(v: number, sigma: number): number {
  if (v <= 0 || sigma <= 0) return 0;
  return (v / (sigma * sigma)) * Math.exp(-(v * v) / (2 * sigma * sigma));
}

/** 莱斯密度，在对数域计算以避免 I0 溢出 */
export function ricePdf(v: number, a: number, sigma: number): number {
  if (v < 0 || sigma <= 0) return 0;
  const s2 = sigma * sigma;
  const z = (v * a) / s2;
  const logTerm = Math.log(Math.max(v, 1e-300) / s2) - (v * v + a * a) / (2 * s2) + z + Math.log(besselI0e(z));
  if (logTerm < -700) return 0;
  return Math.exp(logTerm);
}

export type Moments = {
  n: number;
  mean: number;
  variance: number;
  std: number;
  skewness: number;
  kurtosis: number;
  min: number;
  max: number;
};

/** 二阶矩用无偏估计（n-1），三/四阶矩用 1/n 定义 */
export function moments(data: ArrayLike<number>): Moments {
  const n = data.length;
  if (n === 0) {
    return { n: 0, mean: NaN, variance: NaN, std: NaN, skewness: NaN, kurtosis: NaN, min: NaN, max: NaN };
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += data[i];
  mean /= n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = data[i] - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  const variance = n > 1 ? m2 / (n - 1) : 0;
  const sd = Math.sqrt(Math.max(variance, 1e-300));
  return {
    n,
    mean,
    variance,
    std: sd,
    skewness: n > 1 ? m3 / n / Math.pow(sd, 3) : 0,
    kurtosis: n > 1 ? m4 / n / Math.pow(sd, 4) : 0,
    min,
    max,
  };
}

export type Histogram = {
  centers: Float64Array;
  density: Float64Array;
  counts: Float64Array;
  binWidth: number;
  lo: number;
  hi: number;
};

/** 经验 PDF：等宽直方图，面积为 1 */
export function histogram(data: ArrayLike<number>, bins: number, lo?: number, hi?: number): Histogram {
  const n = data.length;
  if (lo === undefined || hi === undefined) {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) {
      if (data[i] < mn) mn = data[i];
      if (data[i] > mx) mx = data[i];
    }
    lo = lo ?? mn;
    hi = hi ?? mx;
  }
  const a = lo as number;
  const b = hi as number;
  const width = (b - a) / bins || 1;
  const counts = new Float64Array(bins);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((data[i] - a) / width);
    if (idx >= 0 && idx < bins) counts[idx] += 1;
  }
  const centers = new Float64Array(bins);
  const density = new Float64Array(bins);
  for (let i = 0; i < bins; i++) {
    centers[i] = a + (i + 0.5) * width;
    density[i] = counts[i] / (n * width);
  }
  return { centers, density, counts, binWidth: width, lo: a, hi: b };
}

/** 经验累计分布函数（ECDF）阶梯点 */
export function ecdf(data: ArrayLike<number>, points = 320): { x: Float64Array; y: Float64Array } {
  const sorted = Float64Array.from(data as ArrayLike<number>);
  sorted.sort();
  const n = sorted.length;
  const x = new Float64Array(points);
  const y = new Float64Array(points);
  if (n === 0) return { x, y };
  const lo = sorted[0];
  const hi = sorted[n - 1];
  for (let i = 0; i < points; i++) {
    const v = lo + ((hi - lo) * i) / (points - 1);
    let l = 0;
    let r = n - 1;
    let idx = -1;
    while (l <= r) {
      const mid = (l + r) >> 1;
      if (sorted[mid] <= v) {
        idx = mid;
        l = mid + 1;
      } else r = mid - 1;
    }
    x[i] = v;
    y[i] = (idx + 1) / n;
  }
  return { x, y };
}

/** 分位数（线性插值），输入会被复制排序 */
export function quantile(data: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(data as ArrayLike<number>);
  s.sort();
  const n = s.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** 稳健显示区间：截去两端极端值，避免单个野值压扁坐标轴 */
export function robustRange(data: ArrayLike<number>, pLo = 0.001, pHi = 0.999): [number, number] {
  const a = quantile(data, pLo);
  const b = quantile(data, pHi);
  if (!isFinite(a) || !isFinite(b) || b - a < 1e-9) return [a - 1, b + 1];
  const pad = (b - a) * 0.06;
  return [a - pad, b + pad];
}

export function relError(emp: number, theory: number): number {
  if (!isFinite(theory) || Math.abs(theory) < 1e-12) return NaN;
  return ((emp - theory) / Math.abs(theory)) * 100;
}

export function fmt(x: number, digits = 3): string {
  if (!isFinite(x)) return '—';
  const ax = Math.abs(x);
  if (ax !== 0 && (ax < 1e-3 || ax >= 1e5)) return x.toExponential(Math.min(digits, 6));
  return x.toFixed(digits);
}



/** 线性映射到像素（用于 Canvas） */
