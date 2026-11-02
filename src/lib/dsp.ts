/** 离散傅里叶变换、功率谱估计与数字滤波器（全部为纯 JavaScript 实现）。 */

/** 就地迭代 radix-2 FFT，要求长度为 2 的幂 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  // 位反转
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nr = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nr;
      }
    }
  }
}

export function ifftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

export function nextPow2(x: number): number {
  let n = 1;
  while (n < x) n <<= 1;
  return n;
}

export type Spectrum = { freqs: Float64Array; mag: Float64Array };

/** 单边幅度谱（归一化到 2|X|/N） */


/** 周期图（单边 PSD，单位 幅值²/Hz） */
export function periodogram(x: Float64Array, fs: number): Spectrum {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fftInPlace(re, im);
  const half = n >> 1;
  const freqs = new Float64Array(half);
  const mag = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = (k * fs) / n;
    const p = (re[k] * re[k] + im[k] * im[k]) / (n * fs);
    mag[k] = k === 0 ? p : 2 * p;
  }
  return { freqs, mag };
}

/** Welch 平均周期图：50% 重叠 Hann 窗 */
export function welchPsd(x: Float64Array, fs: number, segments = 8): Spectrum {
  const n = x.length;
  const segLen = Math.max(32, Math.floor(n / Math.max(1, segments)));
  const step = Math.max(1, Math.floor(segLen / 2));
  const win = new Float64Array(segLen);
  let winPower = 0;
  for (let i = 0; i < segLen; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (segLen - 1));
    winPower += win[i] * win[i];
  }
  const half = segLen >> 1;
  const acc = new Float64Array(half);
  let count = 0;
  for (let start = 0; start + segLen <= n; start += step) {
    const re = new Float64Array(segLen);
    const im = new Float64Array(segLen);
    for (let i = 0; i < segLen; i++) re[i] = x[start + i] * win[i];
    fftInPlace(re, im);
    for (let k = 0; k < half; k++) {
      acc[k] += (re[k] * re[k] + im[k] * im[k]) / (fs * winPower);
    }
    count++;
  }
  const freqs = new Float64Array(half);
  const mag = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = (k * fs) / segLen;
    const p = acc[k] / Math.max(1, count);
    mag[k] = k === 0 ? p : 2 * p;
  }
  return { freqs, mag };
}

/** 二分插值重采样器：把任意频率网格映射到统一网格 */
export function resample(freqs: Float64Array, values: Float64Array, grid: Float64Array): Float64Array {
  const out = new Float64Array(grid.length);
  const n = freqs.length;
  let j = 0;
  for (let i = 0; i < grid.length; i++) {
    const f = grid[i];
    while (j < n - 2 && freqs[j + 1] < f) j++;
    const f0 = freqs[j];
    const f1 = freqs[Math.min(n - 1, j + 1)];
    const v0 = values[j];
    const v1 = values[Math.min(n - 1, j + 1)];
    const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
    out[i] = v0 + (v1 - v0) * Math.min(1, Math.max(0, t));
  }
  return out;
}

/**
 * 有偏自相关估计（FFT 加速）：R[m] = (1/N) Σ x[n]x[n+m]
 * 返回 m = 0..maxLag
 */
export function autocorrelation(x: Float64Array, maxLag: number): Float64Array {
  const n = x.length;
  const size = nextPow2(2 * n);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fftInPlace(re, im);
  for (let i = 0; i < size; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p;
    im[i] = 0;
  }
  ifftInPlace(re, im);
  const out = new Float64Array(maxLag + 1);
  for (let m = 0; m <= maxLag; m++) out[m] = re[m] / n;
  return out;
}

export type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** RBJ Audio EQ Cookbook 双二阶滤波器系数。类型：lowpass / highpass / bandpass */
export function designBiquad(type: 'lowpass' | 'highpass' | 'bandpass', fc: number, fs: number, q: number): Biquad {
  const f = Math.min(fs * 0.49, Math.max(1e-3, fc));
  const w0 = (2 * Math.PI * f) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * q);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  if (type === 'lowpass') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = (1 - cw) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = (1 + cw) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** 串联双二阶滤波（Direct Form I） */
export function applyBiquadCascade(x: Float64Array, cascades: Biquad[]): Float64Array {
  let cur = Float64Array.from(x);
  for (const c of cascades) {
    const out = new Float64Array(cur.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let n = 0; n < cur.length; n++) {
      const xn = cur[n];
      const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1;
      x1 = xn;
      y2 = y1;
      y1 = yn;
      out[n] = yn;
    }
    cur = out;
  }
  return cur;
}

/** 二阶节幅频响应 |H(f)| */
export function biquadResponse(c: Biquad, f: number, fs: number): number {
  const w = (2 * Math.PI * f) / fs;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const c2w = Math.cos(2 * w);
  const s2w = Math.sin(2 * w);
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const numIm = -(c.b1 * sw + c.b2 * s2w);
  const denRe = 1 + c.a1 * cw + c.a2 * c2w;
  const denIm = -(c.a1 * sw + c.a2 * s2w);
  return Math.hypot(numRe, numIm) / Math.hypot(denRe, denIm);
}

export function cascadeResponse(cascades: Biquad[], f: number, fs: number): number {
  let h = 1;
  for (const c of cascades) h *= biquadResponse(c, f, fs);
  return h;
}

/**
 * 离散希尔伯特变换（频域构造）
 * H[k] = -j·sgn(k) 的实序列版本：
 *   k = 0, N/2 → 0；1 ≤ k < N/2 → -j；N/2 < k < N → +j
 */
export function hilbertTransform(x: Float64Array): Float64Array {
  const n = x.length;
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  fftInPlace(re, im);
  const half = n >> 1;
  for (let k = 1; k < half; k++) {
    const a = re[k];
    const b = im[k];
    // 乘以 -j：(a+jb)(-j) = b - ja
    re[k] = b;
    im[k] = -a;
  }
  for (let k = half + 1; k < n; k++) {
    const a = re[k];
    const b = im[k];
    // 乘以 +j：(a+jb)(j) = -b + ja
    re[k] = -b;
    im[k] = a;
  }
  re[0] = 0;
  im[0] = 0;
  if (n % 2 === 0) {
    re[half] = 0;
    im[half] = 0;
  }
  ifftInPlace(re, im);
  return re;
}

/** 相位解缠 */
export function unwrapPhase(phase: Float64Array): Float64Array {
  const out = Float64Array.from(phase);
  for (let i = 1; i < out.length; i++) {
    let d = out[i] - out[i - 1];
    while (d > Math.PI) {
      out[i] -= 2 * Math.PI;
      d = out[i] - out[i - 1];
    }
    while (d < -Math.PI) {
      out[i] += 2 * Math.PI;
      d = out[i] - out[i - 1];
    }
  }
  return out;
}

/** 时域移动平均去趋势（模拟限带包络的慢变基带） */


/** 一阶 RC 低通（冲激不变法）：H(z)=a/(1−(1−a)z⁻¹)，a = 1−e^{−2πfc/fs} */
export function onePoleRc(x: Float64Array, fc: number, fs: number): Float64Array {
  const a = 1 - Math.exp((-2 * Math.PI * Math.max(1e-9, fc)) / fs);
  const out = new Float64Array(x.length);
  let y = 0;
  for (let n = 0; n < x.length; n++) {
    y += a * (x[n] - y);
    out[n] = y;
  }
  return out;
}

export function onePoleRcResponse(fc: number, fs: number, f: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * Math.max(1e-9, fc)) / fs);
  const w = (2 * Math.PI * f) / fs;
  const b = 1 - a;
  return a / Math.hypot(1 - b * Math.cos(w), b * Math.sin(w));
}

/**
 * 正弦分量在周期图/ Welch 估计下的期望形状（解析可算，非拟合）：
 *
 *   E[P(f)] = 2/(fs·Σw²) · (A/2)² · |Σ_{n=0}^{L-1} w[n] e^{-j2π(f-f0)n/fs}|²
 *
 * 峰值随段长 L 线性增长（A²L/(2fs) 矩形窗、A²L/(3fs) Hann），而谱线"面积"恒为 A²/4，
 * 这正是离散谱线高度依赖频率分辨率的教学要点。
 */
export function sinusoidPsdExpectation(
  amp: number,
  f0: number,
  fs: number,
  segLen: number,
  hann: boolean,
  freqs: ArrayLike<number>,
): Float64Array {
  const L = Math.max(2, Math.floor(segLen));
  const w = new Float64Array(L);
  let sw = 0;
  let sw2 = 0;
  for (let n = 0; n < L; n++) {
    w[n] = hann ? 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (L - 1)) : 1;
    sw += w[n];
    sw2 += w[n] * w[n];
  }
  void sw;
  const out = new Float64Array(freqs.length);
  const a2 = (amp / 2) * (amp / 2);
  const norm = (2 * a2) / (fs * sw2);
  for (let i = 0; i < freqs.length; i++) {
    const df = freqs[i] - f0;
    let re = 0;
    let im = 0;
    const base = (-2 * Math.PI * df) / fs;
    for (let n = 0; n < L; n++) {
      const ph = base * n;
      re += w[n] * Math.cos(ph);
      im += w[n] * Math.sin(ph);
    }
    out[i] = norm * (re * re + im * im);
  }
  return out;
}