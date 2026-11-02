/**
 * 伪随机数发生器（确定性种子）
 * 采用 mulberry32（32 位状态），保证同一 seed 下结果可复现。
 */

export type Rng = {
  uniform: () => number;
  normal: (mu?: number, sigma?: number) => number;
  exponential: (lambda: number) => number;
  reset: (seed: number) => void;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(...values: (number | string | boolean)[]): number {
  let h = 2166136261;
  for (const raw of values) {
    const v = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : hashString(raw);
    const x = Math.round(v * 1000) | 0;
    h ^= x;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

export function createRng(seed: number): Rng {
  let base = seed >>> 0;
  let u = mulberry32(base);
  let spare: number | null = null;
  return {
    uniform: () => u(),
    normal: (mu = 0, sigma = 1) => {
      // Box-Muller 变换，缓存第二个样本
      if (spare !== null) {
        const z = spare;
        spare = null;
        return mu + sigma * z;
      }
      let s = 0;
      let t = 0;
      let r = 0;
      do {
        s = u() * 2 - 1;
        t = u() * 2 - 1;
        r = s * s + t * t;
      } while (r >= 1 || r === 0);
      const m = Math.sqrt((-2 * Math.log(r)) / r);
      spare = t * m;
      return mu + sigma * s * m;
    },
    // 逆变换法：F^{-1}(u) = -ln(1-u)/λ
    exponential: (lambda: number) => -Math.log(1 - u()) / lambda,
    reset: (next: number) => {
      base = next >>> 0;
      u = mulberry32(base);
      spare = null;
    },
  };
}