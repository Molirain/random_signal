import React, { useMemo, useState } from 'react';
import { createRng, seedFrom } from '../lib/rng';
import {
  besselI0,
  fmt,
  histogram,
  moments,
  rayleighPdf,
  relError,
  riceMean,
  ricePdf,
  robustRange,
} from '../lib/math';
import {
  applyBiquadCascade,
  autocorrelation,
  designBiquad,
  hilbertTransform,
  unwrapPhase,
  welchPsd,
  type Biquad,
} from '../lib/dsp';
import {
  ACCENT,
  INK,
  MUTED,
  TRACE,
  WARN,
  drawAxes,
  drawBars,
  drawFill,
  drawHLine,
  drawSeries,
  drawVLine,
} from '../lib/plot';
import {
  Badge,
  Button,
  FieldGroup,
  Figure,
  Panel,
  Segmented,
  Slider,
  StatTable,
  Tex,
  Toggle,
} from '../components/ui';
import {
  ControlHead,
  DiagnosisPanel,
  FormulaCard,
  Steps,
  Workbench,
  type DiagItem,
} from '../components/panels';

const FS = 4000;

export default function Module4() {
  const [f0, setF0] = useState(300);
  const [bw, setBw] = useState(24);
  const [amp, setAmp] = useState(0); // 载波幅度 A
  const [sigma, setSigma] = useState(1);
  const [n, setN] = useState(16384);
  const [seed, setSeed] = useState(9001);
  const [showQuad, setShowQuad] = useState(true);
  const [viewSamples, setViewSamples] = useState(600);

  const duration = n / FS;

  /* ---------------------------------------------- 生成窄带过程 */
  const sim = useMemo(() => {
    const rng = createRng(seedFrom(seed, n, f0, bw, amp, sigma));
    const white = new Float64Array(n);
    for (let i = 0; i < n; i++) white[i] = rng.normal(0, sigma);

    const q = Math.max(0.8, f0 / Math.max(1, bw));
    const stages: Biquad[] = [
      designBiquad('bandpass', f0, FS, q),
      designBiquad('bandpass', f0, FS, q),
    ];
    const narrowRaw = applyBiquadCascade(white, stages);
        // 按取样段归一化到用户设定的 σ，使包络/正交分量的量纲直观可比
    const rawStd = Math.sqrt(Math.max(1e-12, moments(narrowRaw).variance));
        const scale = sigma / rawStd;
        const narrow = new Float64Array(n);
        for (let i = 0; i < n; i++) narrow[i] = narrowRaw[i] * scale;

    const x = new Float64Array(n);
    const t = new Float64Array(n);
    const w0 = (2 * Math.PI * f0) / FS;
    for (let i = 0; i < n; i++) {
      t[i] = i / FS;
      x[i] = narrow[i] + amp * Math.cos(2 * Math.PI * f0 * t[i]);
    }

    const z = hilbertTransform(x);
    const xc = new Float64Array(n);
    const xs = new Float64Array(n);
    const env = new Float64Array(n);
    const phase = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = Math.cos(w0 * i);
      const s = Math.sin(w0 * i);
      // 复包络 = z·e^{-jω₀t}
      xc[i] = x[i] * c + z[i] * s;
      xs[i] = z[i] * c - x[i] * s;
      env[i] = Math.hypot(x[i], z[i]);
      phase[i] = Math.atan2(xs[i], xc[i]);
    }

    const sigmaQ = Math.sqrt(Math.max(1e-9, moments(narrow).variance));
    return { x, narrow, xc, xs, env, phase, t, sigmaQ, q };
  }, [seed, n, f0, bw, amp, sigma]);

  /* ---------------------------------------------- 统计 */
  const mEnv = useMemo(() => moments(sim.env), [sim.env]);
  const mXc = useMemo(() => moments(sim.xc), [sim.xc]);
  const mXs = useMemo(() => moments(sim.xs), [sim.xs]);
  const sigmaTh = sim.sigmaQ;
  const riceK = amp > 0 ? (amp * amp) / (2 * sigmaTh * sigmaTh) : 0;

  const envHist = useMemo(() => {
    const hi = Math.max(
      (amp + 5 * sigmaTh),
      mEnv.max * 1.02,
      amp + 4.5 * sigmaTh,
    );
    return histogram(sim.env, 60, 0, hi);
  }, [sim.env, amp, sigmaTh, mEnv.max]);

  const quadHist = useMemo(() => {
    const [lo, hi] = robustRange(sim.xc, 0.001, 0.999);
    return {
      xc: histogram(sim.xc, 46, lo, hi),
      xs: histogram(sim.xs, 46, lo, hi),
      lo,
      hi,
    };
  }, [sim.xc, sim.xs]);

  const phaseHist = useMemo(() => histogram(sim.phase, 36, -Math.PI, Math.PI), [sim.phase]);

  const acfEnv = useMemo(() => {
    const maxLag = Math.min(n / 2, 400);
    return {
      env: autocorrelation(sim.env, maxLag),
      narrow: autocorrelation(sim.narrow, maxLag),
      maxLag,
    };
  }, [sim]);

  const psd = useMemo(() => welchPsd(sim.x, FS, 8), [sim.x]);

  /* ---------------------------------------------- 理论值 */
  const theory = useMemo(() => {
      const meanEnv = sigmaTh * Math.sqrt(Math.PI / 2);
      const env2 = 2 * sigmaTh * sigmaTh + amp * amp;
      const meanRice = riceMean(sigmaTh, amp);
      return { meanRice, meanEnv2: env2, meanEnvRayleigh: meanEnv, riceK };
    }, [sigmaTh, amp, riceK]);

  /* ---------------------------------------------- 诊断 */
    // 基带过程的有效独立样本数 ≈ 2·B·T，据此给出各统计量的抽样标准误
    const effectiveSamples = Math.max(1, 2 * bw * duration);
    const seOfMean = sigmaTh / Math.sqrt(effectiveSamples);
    const diag: DiagItem[] = useMemo(() => {
      const items: DiagItem[] = [];
      const empiricalMean = mEnv.mean;
      const errMean = relError(empiricalMean, theory.meanRice);
      const zMean = Math.abs(empiricalMean - theory.meanRice) / Math.max(1e-9, seOfMean * 1.05);
      if (amp === 0) {
        items.push({
          tone: zMean < 3 ? 'ok' : 'warn',
          title: '瑞利分布拟合',
          body: `包络均值经验 ${fmt(empiricalMean, 4)} / 理论 σ√(π/2) = ${fmt(theory.meanEnvRayleigh, 4)}，相对误差 ${fmt(errMean, 2)}%（${zMean.toFixed(1)}σ）。σ = ${fmt(sigmaTh, 4)} 由带通输出的标准差确定，而非直接取自输入参数。`,
        });
        items.push({
          tone: 'info',
          title: '包络的二阶矩',
          body: `E[V²] = 2σ² = ${fmt(2 * sigmaTh * sigmaTh, 4)}，经验值 ${fmt(mEnv.variance + empiricalMean ** 2, 4)}。由 V² = Xc² + Xs²，这等于两个独立同分布高斯分量的功率之和。`,
        });
      } else {
        items.push({
          tone: zMean < 3 ? 'ok' : 'warn',
          title: '莱斯分布拟合',
          body: `载波幅度 A = ${amp.toFixed(2)}，莱斯因子 K = A²/(2σ²) = ${fmt(riceK, 3)}（${(10 * Math.log10(Math.max(1e-6, riceK))).toFixed(2)} dB）。包络均值经验 ${fmt(empiricalMean, 4)} / 理论 ${fmt(theory.meanRice, 4)}，误差 ${fmt(errMean, 2)}%（${zMean.toFixed(1)}σ）。`,
        });
        items.push({
          tone: riceK > 10 ? 'warn' : 'info',
          title: riceK > 10 ? '强载波：莱斯退化为高斯' : '弱载波：趋向瑞利',
          body:
            riceK > 10
              ? 'K ≫ 1 时包络集中在 A 附近，可用高斯近似 f_V(v) ≈ N(A, σ²)。此时“衰落”几乎消失，只剩小起伏。'
              : 'K ≪ 1 时载波被噪声淹没，莱斯分布渐近瑞利；A → 0 时 I₀(0) = 1，两式严格一致。',
        });
      }
      const mxc = mXc.mean;
      items.push({
        tone: Math.abs(mxc - amp) < 3 * seOfMean ? 'ok' : 'warn',
        title: '正交分量的均值',
        body: `E[X_c] 经验 ${fmt(mxc, 4)}，理论 ${fmt(amp, 4)}；E[X_s] 经验 ${fmt(mXs.mean, 4)}，理论 0。基带过程的有效独立样本仅约 2BT = ${effectiveSamples.toFixed(0)} 个，均值的标准误约 ${fmt(seOfMean, 4)}，因此百分位之后的小数没有统计意义。载波只进入同相支路，这是相干解调能恢复相位的物理基础。`,
      });
      items.push({
        tone: 'info',
        title: '正交分量的带宽',
        body: `窄带带宽 B ≈ ${bw.toFixed(0)} Hz，f₀/B = ${(f0 / bw).toFixed(1)}。同相与正交分量是基带慢变过程，其带宽为 B/2 量级，远小于 f₀，因此可以用远低于 2f₀ 的速率采样——这就是复包络表示的实际价值。`,
      });
      items.push({
        tone: amp === 0 ? 'info' : 'warn',
        title: amp === 0 ? '相位近似均匀分布' : '载波使相位集中',
        body:
          amp === 0
            ? '零均值窄带高斯过程的相位 Φ 在 (−π, π] 上均匀分布，且与包络 V 相互独立。这一独立性是瑞利/莱斯建模最容易被忽略的前提。'
            : `存在载波时相位不再是均匀分布，其密度为 f_Φ(φ) = (1/2π)e^{-K}[1+√(πK)cosφ·e^{Kcos²φ}(1+erf(√K cosφ))]，随 K 增大而向 φ=0 集中。`,
      });
      return items;
    }, [amp, mEnv, mXc, mXs, sigmaTh, theory, riceK, bw, f0, seOfMean, effectiveSamples]);

  /* ---------------------------------------------- 绘图 */
  const drawWave = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 46, y: 16, w: w - 62, h: h - 54 };
        // 限制显示周期数上限，避免高载频时波形挤成实心带
        const cycleCap = Math.round(((60 / Math.max(20, f0)) * FS));
        const view = Math.max(200, Math.min(n, viewSamples, cycleCap));
        const t = new Float64Array(view);
        const x = new Float64Array(view);
        const e1 = new Float64Array(view);
        const e2 = new Float64Array(view);
    let peak = 0;
    for (let i = 0; i < view; i++) {
      t[i] = i / FS;
      x[i] = sim.x[i];
      e1[i] = sim.env[i];
      e2[i] = -sim.env[i];
      peak = Math.max(peak, Math.abs(sim.x[i]), sim.env[i]);
    }
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, view / FS],
      yDomain: [-peak * 1.08, peak * 1.08],
      xLabel: '时间 t / s',
      yLabel: '幅值',
      title: '窄带过程及其包络',
      titleSub: `f₀=${f0}Hz · B≈${bw}Hz · Q≈${sim.q.toFixed(1)}`,
    });
    drawSeries(ctx, t, x, ax.xs, ax.ys, { color: ACCENT, width: 1 });
    drawSeries(ctx, t, e1, ax.xs, ax.ys, { color: WARN, width: 1.1, dash: [4, 2] });
    drawSeries(ctx, t, e2, ax.xs, ax.ys, { color: WARN, width: 1.1, dash: [4, 2] });
  };

  const drawQuad = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 46, y: 16, w: w - 62, h: h - 54 };
      // 基带分量是慢变过程：按带宽取约 8 个包络起伏周期，避免载波振荡挤成实心块
      const view = Math.max(200, Math.min(n, Math.round((8 / Math.max(1, bw)) * FS)));
      const t = new Float64Array(view);
      const xc = new Float64Array(view);
      const xs = new Float64Array(view);
      let peak = 0;
      for (let i = 0; i < view; i++) {
        t[i] = i / FS;
        xc[i] = sim.xc[i];
        xs[i] = sim.xs[i];
        peak = Math.max(peak, Math.abs(xc[i]), Math.abs(xs[i]));
      }
      const ax = drawAxes(ctx, rect, {
        xDomain: [0, view / FS],
        yDomain: [-peak * 1.12, peak * 1.12],
        xLabel: '时间 t / s',
        yLabel: '基带幅值',
        title: '同相 / 正交分量（复包络）',
        titleSub: `希尔伯特变换解调 · ${view} 点`,
      });
    drawSeries(ctx, t, xc, ax.xs, ax.ys, { color: INK, width: 1.1 });
    drawSeries(ctx, t, xs, ax.xs, ax.ys, { color: ACCENT, width: 1.1 });
    drawHLine(ctx, amp, ax.xs, ax.ys, { color: WARN, dash: [3, 3] });
  };

  const drawPhasePlane = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const size = Math.min(w - 62, h - 44);
      const rect = { x: 46, y: 16, w: size, h: size };
      const lim = Math.max(3.6 * sigmaTh, amp + 3 * sigmaTh, 0.8);
      const ax = drawAxes(ctx, rect, {
        xDomain: [-lim, lim],
        yDomain: [-lim, lim],
        xLabel: 'X_c',
        yLabel: 'X_s',
        title: '相平面密度',
        titleSub: amp === 0 ? '瑞利环' : '莱斯偏心圆',
        xTickCount: 4,
        yTickCount: 4,
      });
      // 复包络云团：点密度即为 (X_c, X_s) 的二维分布
      ctx.save();
      ctx.beginPath();
      ctx.rect(ax.xs.r0, ax.ys.r1, ax.xs.r1 - ax.xs.r0, ax.ys.r0 - ax.ys.r1);
      ctx.clip();
      ctx.fillStyle = ACCENT;
      const step = Math.max(1, Math.floor(n / 3000));
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < n; i += step) {
        ctx.fillRect(ax.xs(sim.xc[i]) - 0.5, ax.ys(sim.xs[i]) - 0.5, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
      // 理论 98% 置信圆/环
      ctx.strokeStyle = WARN;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rv = sigmaTh * Math.sqrt(-2 * Math.log(0.02));
      ctx.arc(ax.xs(amp), ax.ys(0), ax.xs(rv) - ax.xs(0), 0, 6.2832);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = WARN;
      ctx.beginPath();
      ctx.arc(ax.xs(amp), ax.ys(0), 2.5, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.font = '8.5px "JetBrains Mono", monospace';
      ctx.fillStyle = MUTED;
      ctx.fillText(`锚点 (A,0)=(${amp.toFixed(2)},0) · r₉₈=${rv.toFixed(2)}`, rect.x + 4, rect.y + rect.h - 6);
      ctx.restore();
    };

  const drawEnvHist = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 48, y: 16, w: w - 64, h: h - 54 };
    const peak = Math.max(...Array.from(envHist.density), rayleighPdf(sigmaTh, sigmaTh) || 0, amp > 0 ? ricePdf(amp, amp, sigmaTh) : 0);
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, envHist.hi],
      yDomain: [0, peak * 1.15],
      xLabel: '包络幅度 v',
      yLabel: 'f_V(v)',
      title: '包络的概率密度',
      titleSub: amp > 0 ? `莱斯 · K=${fmt(riceK, 2)}` : '瑞利 · σ=' + fmt(sigmaTh, 3),
    });
    drawBars(ctx, envHist.centers, envHist.density, envHist.binWidth, ax.xs, ax.ys, {
      fill: '#dbeafe',
      stroke: '#bfdbfe',
    });
    const N = 360;
    const vv = new Float64Array(N);
    const thy = new Float64Array(N);
    const other = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const v = (envHist.hi * i) / (N - 1);
      vv[i] = v;
      thy[i] = amp > 0 ? ricePdf(v, amp, sigmaTh) : rayleighPdf(v, sigmaTh);
      other[i] = amp > 0 ? rayleighPdf(v, sigmaTh) : 0;
    }
    if (amp > 0) {
      drawSeries(ctx, vv, other, ax.xs, ax.ys, { color: '#cbd5e1', width: 1, dash: [5, 3] });
    }
    drawSeries(ctx, vv, thy, ax.xs, ax.ys, { color: INK, width: 1.5 });
    drawVLine(ctx, mEnv.mean, ax.xs, ax.ys, { color: ACCENT, dash: [3, 3] });
  };

  const drawQuadHist = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 46, y: 16, w: w - 62, h: h - 54 };
    const peak = Math.max(...Array.from(quadHist.xc.density), ...Array.from(quadHist.xs.density));
    const ax = drawAxes(ctx, rect, {
      xDomain: [quadHist.lo, quadHist.hi],
      yDomain: [0, peak * 1.15],
      xLabel: '基带幅值',
      yLabel: '密度',
      title: '正交分量的边缘密度',
      titleSub: '两者均为高斯',
    });
    drawBars(ctx, quadHist.xc.centers, quadHist.xc.density, quadHist.xc.binWidth, ax.xs, ax.ys, {
      fill: '#e2e8f0',
      stroke: '#cbd5e1',
    });
    drawBars(ctx, quadHist.xs.centers, quadHist.xs.density, quadHist.xs.binWidth, ax.xs, ax.ys, {
      fill: '#dbeafe',
      stroke: '#bfdbfe',
      alpha: 0.75,
    });
    const N = 260;
    const xx = new Float64Array(N);
    const g1 = new Float64Array(N);
    const g2 = new Float64Array(N);
    const gauss = (v: number, mu: number, s: number) => Math.exp(-((v - mu) ** 2) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
    for (let i = 0; i < N; i++) {
      const v = quadHist.lo + ((quadHist.hi - quadHist.lo) * i) / (N - 1);
      xx[i] = v;
      g1[i] = gauss(v, mXc.mean, Math.max(1e-6, mXc.std));
      g2[i] = gauss(v, mXs.mean, Math.max(1e-6, mXs.std));
    }
    drawSeries(ctx, xx, g1, ax.xs, ax.ys, { color: INK, width: 1.2 });
    drawSeries(ctx, xx, g2, ax.xs, ax.ys, { color: ACCENT, width: 1.2, dash: [4, 3] });
  };

  const drawPsdFig = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 50, y: 16, w: w - 66, h: h - 54 };
    const fMax = Math.min(FS / 2, Math.max(3 * f0, 500));
    let peak = 0;
    for (let i = 0; i < psd.freqs.length; i++) if (psd.freqs[i] <= fMax) peak = Math.max(peak, psd.mag[i]);
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, fMax],
      yDomain: [0, peak * 1.2],
      xLabel: '频率 f / Hz',
      yLabel: 'S_X(f)',
      title: '窄带过程的功率谱',
      titleSub: `Welch · 3dB 带宽 ≈ ${bw}Hz`,
    });
    const fr: number[] = [];
    const mg: number[] = [];
    for (let i = 0; i < psd.freqs.length; i++) {
      if (psd.freqs[i] <= fMax) {
        fr.push(psd.freqs[i]);
        mg.push(psd.mag[i]);
      }
    }
    drawFill(ctx, Float64Array.from(fr), Float64Array.from(mg), ax.xs, ax.ys, { fill: ACCENT, alpha: 0.14 });
    drawSeries(ctx, Float64Array.from(fr), Float64Array.from(mg), ax.xs, ax.ys, { color: ACCENT, width: 1.1 });
    drawVLine(ctx, f0, ax.xs, ax.ys, { color: WARN, dash: [2, 3], label: `f₀=${f0}` });
    drawVLine(ctx, f0 - bw / 2, ax.xs, ax.ys, { color: '#cbd5e1', dash: [1, 3] });
    drawVLine(ctx, f0 + bw / 2, ax.xs, ax.ys, { color: '#cbd5e1', dash: [1, 3] });
  };

  const drawAcfFig = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 48, y: 16, w: w - 64, h: h - 54 };
    const lagMax = Math.min(acfEnv.maxLag, Math.round(FS * 0.06));
    const tau = new Float64Array(lagMax + 1);
    const env = new Float64Array(lagMax + 1);
    const nb = new Float64Array(lagMax + 1);
    for (let m = 0; m <= lagMax; m++) {
      tau[m] = m / FS;
      env[m] = acfEnv.env[m];
      nb[m] = acfEnv.narrow[m];
    }
    const peak = Math.max(...Array.from(nb), 1e-9);
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, lagMax / FS],
      yDomain: [-peak, peak * 1.1],
      xLabel: '时延 τ / s',
      yLabel: 'R(τ)',
      title: '窄带过程包络相关与载波振荡',
      titleSub: 'R_X(τ) ≈ R_env(τ)cos(ω₀τ)',
    });
    drawSeries(ctx, tau, nb, ax.xs, ax.ys, { color: ACCENT, width: 1.1 });
    drawSeries(ctx, tau, env, ax.xs, ax.ys, { color: WARN, width: 1.1, dash: [4, 2] });
  };

  const drawPhaseHist = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 46, y: 16, w: w - 62, h: h - 54 };
    const peak = Math.max(...Array.from(phaseHist.density), 1 / (2 * Math.PI));
        // 横轴以 π 为单位，避免刻度被渲染成 −3 / −2 这类无意义整数
        const centersPi = new Float64Array(phaseHist.centers.length);
        for (let i = 0; i < centersPi.length; i++) centersPi[i] = phaseHist.centers[i] / Math.PI;
        const ax = drawAxes(ctx, rect, {
          xDomain: [-1, 1],
          yDomain: [0, peak * 1.2],
          xLabel: '相位 φ / π rad',
          yLabel: 'f_Φ(φ)',
          title: '相位的概率密度',
          titleSub: amp === 0 ? '理论：均匀 1/2π' : '理论：向 0 集中',
          xTicks: [-1, -0.5, 0, 0.5, 1],
        });
        drawBars(ctx, centersPi, phaseHist.density, phaseHist.binWidth / Math.PI, ax.xs, ax.ys, {
          fill: '#dbeafe',
          stroke: '#bfdbfe',
        });
        drawHLine(ctx, 1 / (2 * Math.PI), ax.xs, ax.ys, { color: WARN, dash: [4, 3] });
    if (amp > 0) {
      const N = 260;
      const px = new Float64Array(N);
      const py = new Float64Array(N);
      const K = riceK;
      for (let i = 0; i < N; i++) {
            const phiPi = -1 + (2 * i) / (N - 1);
            px[i] = phiPi;
            const phi = phiPi * Math.PI;
            // Rice 相位密度：f(φ)=e^{-K}/(2π)·[1+√(πK)cosφ·e^{Kcos²φ}(1+erf(√K cosφ))]
            const c = Math.cos(phi);
            const term = 1 + Math.sqrt(Math.PI * K) * c * Math.exp(K * c * c) * (1 + erfLocal(Math.sqrt(K) * c));
        py[i] = (1 / (2 * Math.PI)) * Math.exp(-K) * term;
      }
      drawSeries(ctx, px, py, ax.xs, ax.ys, { color: INK, width: 1.2, dash: [5, 3] });
    }
  };

  /* ---------------------------------------------- 渲染 */
  return (
    <Workbench
      controls={
        <>
          <ControlHead chapter="模块 04 / CH.4" name="窄带随机过程" />
          <FieldGroup title="窄带噪声">
            <Slider label="中心频率" symbol="f₀" value={f0} min={80} max={800} step={10} digits={0} unit="Hz" onChange={setF0} />
            <Slider label="3dB 带宽" symbol="B" value={bw} min={4} max={200} step={2} digits={0} unit="Hz" onChange={setBw} />
            <Slider label="噪声标准差" symbol="σ" value={sigma} min={0.2} max={2} step={0.05} onChange={setSigma} />
            <div className="px-3 pb-1">
              <span className="num text-[9px] text-slate-400">
                f₀/B = {(f0 / bw).toFixed(1)} · Q ≈ {sim.q.toFixed(1)}
              </span>
            </div>
          </FieldGroup>
          <FieldGroup title="确定性载波">
            <Slider label="载波幅度" symbol="A" value={amp} min={0} max={4} step={0.05} onChange={setAmp} />
            <div className="flex gap-1 px-3 pb-2">
              {[
                { v: 0, l: '纯噪声' },
                { v: 1, l: 'A=1' },
                { v: 2.5, l: '强载波' },
              ].map((p) => (
                <Button key={p.l} variant={amp === p.v ? 'primary' : 'default'} onClick={() => setAmp(p.v)}>
                  {p.l}
                </Button>
              ))}
            </div>
          </FieldGroup>
          <FieldGroup title="采样与显示">
            <Segmented
              label="样本数 N（2 的幂）"
              options={[
                              { value: 8192, label: '8192' },
                              { value: 16384, label: '16384' },
                              { value: 32768, label: '32768' },
              ]}
              columns={3}
              value={n}
              onChange={(v) => setN(Number(v))}
            />
            <Slider
                          label="波形显示点数"
              value={viewSamples}
              min={200}
              max={2000}
              step={100}
              digits={0}
              onChange={setViewSamples}
            />
            <Toggle label="显示正交分量" checked={showQuad} onChange={setShowQuad} />
            <div className="flex gap-1 px-3 pb-2 pt-1">
              <Button variant="primary" className="flex-1" onClick={() => setSeed((s) => s + 3571)}>
                重新生成
              </Button>
            </div>
            <div className="px-3 pb-2">
              <span className="num text-[9px] text-slate-400">
                SEED={seed} · T={duration.toFixed(2)}s · fs={FS}Hz
              </span>
            </div>
          </FieldGroup>
          <FieldGroup title="统计对照">
            <StatTable
              compact
              rows={[
                { label: '包络均值', symbol: 'E[V]', empirical: mEnv.mean, theoretical: theory.meanRice, digits: 3 },
                { label: '同相均值', symbol: 'E[X_c]', empirical: mXc.mean, theoretical: amp, digits: 3 },
                { label: '正交均值', symbol: 'E[X_s]', empirical: mXs.mean, theoretical: 0, digits: 3 },
                { label: '分量方差', symbol: 'σ_Q²', empirical: mXc.variance, theoretical: sigmaTh * sigmaTh, digits: 3 },
              ]}
            />
          </FieldGroup>
        </>
      }
      center={
        <>
          <Figure
            code="A"
            title="窄带波形与包络"
            meta={`${viewSamples} 点 · B=${bw}Hz`}
            height={236}
            draw={drawWave}
            deps={[sim, viewSamples, f0, bw]}
                        legend={[
                          { label: 'X(t)', color: ACCENT },
                          { label: '±V(t) 包络', color: WARN, dash: true },
                        ]}
                        note={
                          <>
                            蓝色高频振荡即为窄带过程 <Tex>{String.raw`X(t)`}</Tex>，橙色虚线为希尔伯特变换得到的解析包络
                            <Tex>{String.raw`\pm V(t)`}</Tex>。包络变化速率远慢于载波，体现“窄带”含义。
                          </>
                        }
                      />
          {showQuad && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Figure
                code="B"
                title="同相 / 正交分量"
                meta="复包络"
                height={212}
                draw={drawQuad}
                deps={[sim, amp, bw]}
                                legend={[
                                  { label: 'X_c(t)', color: INK },
                                  { label: 'X_s(t)', color: ACCENT },
                                  ...(amp > 0 ? [{ label: 'E[X_c]=A', color: WARN, dash: true }] : []),
                                ]}
                              />
              <Figure
                code="C"
                title="相平面轨迹"
                meta="瑞利环"
                height={212}
                draw={drawPhasePlane}
                deps={[sim, sigmaTh, amp]}
                                legend={[
                                  { label: '复包络样本', color: ACCENT },
                                  { label: '98% 置信圆', color: WARN, dash: true },
                                ]}
                              />
            </div>
          )}
          <Figure
            code="D"
            title="包络分布：瑞利 / 莱斯"
            meta={amp > 0 ? `K=${fmt(riceK, 2)}` : '纯噪声'}
            height={252}
            draw={drawEnvHist}
            deps={[envHist, amp, sigmaTh, mEnv.mean, riceK]}
                        legend={[
                          { label: '经验直方图', color: '#bfdbfe', fill: true },
                          { label: amp > 0 ? 'Rice 理论' : 'Rayleigh 理论', color: INK },
                          ...(amp > 0 ? [{ label: 'Rayleigh 对照', color: '#cbd5e1', dash: true }] : []),
                          { label: '经验均值', color: ACCENT, dash: true },
                        ]}
                        note={
              <>
                零均值窄带高斯噪声的包络服从瑞利分布；叠加幅度为 <Tex>{String.raw`A`}</Tex> 的确定性载波后转为莱斯分布。
                拖动 <span className="num">A</span> 观察直方图从原点处的零点抬升为偏心峰。
              </>
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Figure
              code="E"
              title="正交分量的边缘分布"
              meta="高斯性校验"
              height={206}
              draw={drawQuadHist}
              deps={[quadHist, mXc, mXs]}
                            legend={[
                              { label: 'X_c 直方图', color: '#cbd5e1', fill: true },
                              { label: 'X_s 直方图', color: '#bfdbfe', fill: true },
                              { label: '高斯拟合', color: INK },
                            ]}
                          />
            <Figure
              code="F"
              title="相位分布"
              meta={amp === 0 ? '均匀' : '集中'}
              height={206}
              draw={drawPhaseHist}
              deps={[phaseHist, amp, riceK]}
                            legend={[
                              { label: '经验相位', color: '#dbeafe', fill: true },
                              { label: amp === 0 ? '均匀 1/2π' : 'Rice 相位密度', color: amp === 0 ? WARN : INK, dash: true },
                            ]}
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <Figure
                            code="G"
                            title="窄带功率谱"
                            meta="Welch 估计"
                            height={200}
                            draw={drawPsdFig}
                            deps={[psd, f0, bw]}
                            legend={[
                              { label: 'S_X(f)', color: ACCENT },
                              { label: '3dB 带边', color: '#cbd5e1', dash: true },
                            ]}
                          />
                          <Figure
                            code="H"
                            title="自相关与包络相关"
                            meta="载波振荡 + 慢变包络"
                            height={200}
                            draw={drawAcfFig}
                            deps={[acfEnv]}
                            legend={[
                              { label: 'R_X(τ)', color: ACCENT },
                              { label: '包络相关', color: WARN, dash: true },
                            ]}
                          />
                        </div>
          <Panel code="I" title="窄带统计量汇总" bodyClass="">
            <StatTable
              rows={[
                { label: '包络均值', symbol: 'E[V]', empirical: mEnv.mean, theoretical: theory.meanRice },
                { label: '包络二阶矩', symbol: 'E[V²]', empirical: mEnv.variance + mEnv.mean ** 2, theoretical: theory.meanEnv2 },
                { label: '同相分量均值', symbol: 'E[X_c]', empirical: mXc.mean, theoretical: amp },
                { label: '同相分量方差', symbol: 'Var[X_c]', empirical: mXc.variance, theoretical: sigmaTh * sigmaTh },
                { label: '正交分量方差', symbol: 'Var[X_s]', empirical: mXs.variance, theoretical: sigmaTh * sigmaTh },
                { label: '包络标准差', symbol: 'σ_V', empirical: mEnv.std, theoretical: Math.sqrt(Math.max(0, theory.meanEnv2 - theory.meanRice ** 2)) },
              ]}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline bg-panel px-3 py-[4px]">
              <Badge tone="blue">瑞利 ⇄ 莱斯</Badge>
              <span className="num text-[9px] text-slate-400">
                σ_quad = {fmt(sigmaTh, 4)} · K = {fmt(riceK, 3)}（{amp > 0 ? (10 * Math.log10(Math.max(1e-9, riceK))).toFixed(2) : '−∞'} dB）
              </span>
              <span className="num ml-auto text-[9px] text-slate-400">
                N·B/fs = {((n * bw) / FS).toFixed(0)} 独立样本
              </span>
            </div>
          </Panel>
        </>
      }
      right={
        <>
          <FormulaCard
            items={[
              {
                label: '窄带表示',
                tex: String.raw`X(t)=X_c(t)\cos\omega_0t-X_s(t)\sin\omega_0t`,
                note: `ω₀ = 2π·${f0} rad/s`,
              },
              {
                label: '解析信号与复包络',
                tex: String.raw`Z(t)=X(t)+j\hat X(t)=\big[X_c(t)+jX_s(t)\big]e^{j\omega_0t}`,
                note: 'X̂ 由离散希尔伯特变换（频域 −j·sgn(ω)）得到',
              },
              {
                label: '包络与相位',
                tex: String.raw`V(t)=\sqrt{X_c^2(t)+X_s^2(t)},\quad \Phi(t)=\arctan\frac{X_s(t)}{X_c(t)}`,
              },
              {
                label: '瑞利分布（A = 0）',
                tex: String.raw`f_V(v)=\frac{v}{\sigma^2}\exp\left(-\frac{v^2}{2\sigma^2}\right)u(v)`,
                note: `当前 σ = ${fmt(sigmaTh, 4)}，E[V] = σ√(π/2) = ${fmt(theory.meanEnvRayleigh, 4)}`,
              },
              {
                label: '莱斯分布（A > 0）',
                tex: String.raw`f_V(v)=\frac{v}{\sigma^2}e^{-\frac{v^2+A^2}{2\sigma^2}}I_0\!\left(\frac{vA}{\sigma^2}\right)u(v)`,
                note: `A = ${amp.toFixed(2)}，K = A²/(2σ²) = ${fmt(riceK, 3)}`,
              },
              {
                label: '莱斯因子',
                tex: String.raw`K=\frac{A^2}{2\sigma^2}=\frac{P_{\text{los}}}{P_{\text{scatter}}}`,
              },
            ]}
          />
          <DiagnosisPanel
            items={diag}
            verdict={amp === 0 ? '瑞利模型' : riceK > 10 ? '莱斯 → 高斯' : '莱斯模型'}
            verdictTone={Math.abs(relError(mEnv.mean, theory.meanRice)) < 5 ? 'ok' : 'warn'}
            state={{
              module: 'narrowband/envelope',
              params: { f0, bandwidth: bw, carrierA: amp, sigmaInput: sigma, fs: FS, N: n },
              empirical: {
                envelopeMean: mEnv.mean,
                envelopeVariance: mEnv.variance,
                xcMean: mXc.mean,
                xsMean: mXs.mean,
                quadVariance: mXc.variance,
              },
              theoretical: {
                sigmaQuadrature: sigmaTh,
                envelopeMean: theory.meanRice,
                envelopeSecondMoment: theory.meanEnv2,
                riceFactor: riceK,
              },
            }}
          />
          <Steps
            items={[
              {
                q: '为什么包络服从瑞利分布？',
                a: 'X_c 与 X_s 是零均值、等方差 σ²、相互独立的高斯变量。极坐标变换后联合密度为 (v/σ²)e^{−v²/(2σ²)}·(1/2π)，对相位积分即得瑞利。注意前提是“零均值 + 独立同分布 + 高斯”。',
              },
              {
                q: '载波如何把瑞利变成莱斯？',
                a: '加入 A·cos(ω₀t) 后，同相分量均值变为 A 而正交分量均值仍为 0。此时 V = √((A+X_c)² + X_s²)，是偏心高斯在极坐标下的模，导出含 I₀ 的莱斯密度。A → 0 时 I₀(0)=1，退化为瑞利。',
              },
              {
                q: '希尔伯特变换为什么能分离正交分量？',
                a: '解析信号 Z 只含正频率分量，乘以 e^{−jω₀t} 把中心频率搬到 0，得到带宽为 B/2 的复基带信号；它的实部即 X_c、虚部即 X_s。这一步在频域是理想移相器 −j·sgn(ω)。',
              },
              {
                q: 'f₀/B 的比值有什么意义？',
                a: '该比值就是品质因数 Q。Q ≫ 1 时包络在一个载波周期内近似不变，“窄带”近似成立；Q 接近 1 时包络变化与载波同速，X_c、X_s 不再慢变，窄带模型失效。',
              },
            ]}
          />
        </>
      }
    />
  );
}

/** 标准正态误差函数（用于 Rice 相位密度） */
function erfLocal(x: number): number {
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