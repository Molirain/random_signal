/* 数值自检脚本（仅开发期使用，不进入构建产物） */
import {
  ricePdf,
  riceMean,
  rayleighPdf,
  moments,
  besselI0,
  besselI0e,
  laguerreHalf,
} from '../src/lib/math';
import { createRng } from '../src/lib/rng';
import {
  autocorrelation,
  designBiquad,
  applyBiquadCascade,
  biquadResponse,
  hilbertTransform,
  periodogram,
  welchPsd,
  sinusoidPsdExpectation,
} from '../src/lib/dsp';

let fails = 0;
function check(name: string, ok: boolean, extra = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
}

function integrate(f: (x: number) => number, a: number, b: number, n = 4000) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}

check('I0(0)=1', Math.abs(besselI0(0) - 1) < 1e-12);
check('I0(5) 参考值', Math.abs(besselI0(5) - 27.239871823604442) < 1e-6, String(besselI0(5)));
check('I0e(30) 渐近稳定', Math.abs(besselI0e(30) - 0.0731461) < 1e-5, String(besselI0e(30)));
check('laguerreHalf(0)=1', Math.abs(laguerreHalf(0) - 1) < 1e-12);

for (const [sigma, a] of [
  [1, 0],
  [1, 1],
  [0.5, 2],
  [1, 5],
] as const) {
  const mass = integrate((v) => (a === 0 ? rayleighPdf(v, sigma) : ricePdf(v, a, sigma)), 0, a + 12 * sigma);
  check(`PDF 归一化 σ=${sigma} A=${a}`, Math.abs(mass - 1) < 3e-3, mass.toFixed(5));
  const mNum = integrate((v) => v * ricePdf(v, a, sigma), 0, a + 14 * sigma);
  const mTheo = riceMean(sigma, a);
  check(
    `Rice 均值 σ=${sigma} A=${a}`,
    Math.abs(mNum - mTheo) / mTheo < 3e-3,
    `${mNum.toFixed(5)} vs ${mTheo.toFixed(5)}`,
  );
}

{
  const rng = createRng(1234);
  const buf = new Float64Array(200000);
  for (let i = 0; i < buf.length; i++) buf[i] = rng.normal(0, 1);
  const m = moments(buf);
  check('正态均值≈0', Math.abs(m.mean) < 0.01, m.mean.toFixed(5));
  check('正态方差≈1', Math.abs(m.variance - 1) < 0.02, m.variance.toFixed(5));
  check('正态峰度≈3', Math.abs(m.kurtosis - 3) < 0.05, m.kurtosis.toFixed(5));
}

{
  const rng = createRng(9);
  const n = 512;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.normal();
  const r = autocorrelation(x, 40);
  for (const lag of [0, 1, 7, 40]) {
    let s = 0;
    for (let i = 0; i < n - lag; i++) s += x[i] * x[i + lag];
    check(`自相关 lag=${lag}`, Math.abs(r[lag] - s / n) < 1e-9, `${r[lag].toFixed(6)} vs ${(s / n).toFixed(6)}`);
  }
}

{
  // 使用窗口内整周期数，避免 FFT 希尔伯特变换的周期性边界误差
  const n = 1024;
  const fs = 1000;
  const f0 = (fs * 64) / n;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = 2 * Math.cos((2 * Math.PI * f0 * i) / fs);
  const h = hilbertTransform(x);
  let maxErr = 0;
  let phaseErr = 0;
  for (let i = 0; i < n; i++) {
    maxErr = Math.max(maxErr, Math.abs(Math.hypot(x[i], h[i]) - 2));
    const want = Math.atan2(Math.sin((2 * Math.PI * f0 * i) / fs), Math.cos((2 * Math.PI * f0 * i) / fs));
    const got = Math.atan2(h[i], x[i]);
    phaseErr = Math.max(phaseErr, Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want))));
  }
  check('希尔伯特包络 = 2（整周期）', maxErr < 1e-6, maxErr.toExponential(2));
  check('希尔伯特相位 = +ω₀t', phaseErr < 1e-6, phaseErr.toExponential(2));
}

{
  const fs = 2000;
  const fc = 120;
  const sections = [0, 1].map((i) =>
    designBiquad('lowpass', fc, fs, 1 / (2 * Math.cos((Math.PI * (2 * i + 1)) / (2 * 4)))),
  );
  check(
    '低通 |H(0)|≈1',
    Math.abs(sections.reduce((acc, c) => acc * biquadResponse(c, 0.0001, fs), 1) - 1) < 1e-4,
  );
  check(
    '低通 |H(fc)|≈0.707',
    Math.abs(sections.reduce((acc, c) => acc * biquadResponse(c, fc, fs), 1) - Math.SQRT1_2) < 6e-3,
  );

  const rng = createRng(77);
  const n = 32768;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = rng.normal();
  const y = applyBiquadCascade(x, sections);
  const vy = moments(y).variance;
  const P = 4000;
  let integ = 0;
  for (let i = 0; i < P; i++) {
    const f = ((fs / 2) * (i + 0.5)) / P;
    let h2 = 1;
    for (const c of sections) h2 *= biquadResponse(c, f, fs) ** 2;
    integ += h2 * (fs / 2 / P);
  }
  const theo = (2 / fs) * integ;
  check('输出方差 = (2/fs)∫|H|²df', Math.abs(vy - theo) / theo < 0.08, `${vy.toFixed(4)} vs ${theo.toFixed(4)}`);
}

{
  const fs = 4000;
  const n = 4096;
  const f0 = 300;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = 1.5 * Math.cos((2 * Math.PI * f0 * i) / fs);
  const p = periodogram(x, fs);
  let peakIdx = 0;
  for (let i = 1; i < p.mag.length; i++) if (p.mag[i] > p.mag[peakIdx]) peakIdx = i;
  check('周期图峰值定位', Math.abs(p.freqs[peakIdx] - f0) < fs / n, String(p.freqs[peakIdx]));
  let area = 0;
  for (let i = 1; i < p.mag.length; i++) area += p.mag[i];
  area *= fs / n;
  check('周期图 Parseval 面积 = A²/2', Math.abs(area - 1.125) / 1.125 < 0.04, area.toFixed(4));

  const w = welchPsd(x, fs, 8);
  const segLen = Math.floor(n / 8);
  const expect = sinusoidPsdExpectation(1.5, f0, fs, segLen, true, w.freqs);
  let maxW = 0;
  let maxE = 0;
  for (let i = 0; i < w.mag.length; i++) {
    maxW = Math.max(maxW, w.mag[i]);
    maxE = Math.max(maxE, expect[i]);
  }
  check('Welch 峰值 ≈ 解析期望', Math.abs(maxW - maxE) / maxE < 0.3, `${maxW.toFixed(4)} vs ${maxE.toFixed(4)}`);
}

console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
if (fails > 0) process.exit(1);