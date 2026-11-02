import React, { useMemo, useState } from 'react';
import { createRng, seedFrom } from '../lib/rng';
import { fmt, moments, relError } from '../lib/math';
import {
  applyBiquadCascade,
  autocorrelation,
  cascadeResponse,
  designBiquad,
  onePoleRc,
  onePoleRcResponse,
  periodogram,
  resample,
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

type FilterKind = 'rc' | 'butter' | 'ma' | 'band';
type SpecMethod = 'periodogram' | 'welch';
type InputKind = 'white' | 'colored';

const FS = 2000;

export default function Module3() {
  const PRE_FC = 40;
  const [kind, setKind] = useState<FilterKind>('butter');
  const [fc, setFc] = useState(120);
  const [order, setOrder] = useState(4);
  const [maTaps, setMaTaps] = useState(16);
  const [q, setQ] = useState(3);
  const [n, setN] = useState(8192);
  const [sigma, setSigma] = useState(1);
  const [tone, setTone] = useState(0);
  const [toneF, setToneF] = useState(60);
  const [method, setMethod] = useState<SpecMethod>('welch');
  const [inputKind, setInputKind] = useState<InputKind>('white');
  const [seed, setSeed] = useState(77);
  const [showH, setShowH] = useState(true);
  const [logScale, setLogScale] = useState(true);

    const duration = n / FS;

  /* ---------------------------------------------- 系统设计 */
  const cascades = useMemo<Biquad[]>(() => {
      if (kind === 'ma' || kind === 'rc') return [];
      if (kind === 'band') return [designBiquad('bandpass', fc, FS, q)];
      const stages: Biquad[] = [];
      const sections = Math.max(1, Math.ceil(order / 2));
      // Butterworth 二阶节 Q 值：Q_k = 1/(2cos(θ_k))，θ_k = π(2k+1)/(2n)
      for (let i = 0; i < sections; i++) {
        const theta = (Math.PI * (2 * i + 1)) / (2 * order);
        stages.push(designBiquad('lowpass', fc, FS, 1 / (2 * Math.cos(theta))));
    }
    return stages;
  }, [kind, fc, order, q]);

  const magResponse = (f: number) => {
    if (kind === 'ma') {
      const taps = Math.max(1, Math.round(maTaps));
        if (taps === 1) return 1;
        const x = (Math.PI * f * taps) / FS;
        const den = taps * Math.sin(x / taps);
        return Math.abs(den) < 1e-12 ? 1 : Math.abs(Math.sin(x) / den);
      }
      if (kind === 'rc') return onePoleRcResponse(fc, FS, f);
      return cascadeResponse(cascades, f, FS);
    };

  /* ---------------------------------------------- 输入/输出信号 */
  const sim = useMemo(() => {
    const rng = createRng(seedFrom(seed, n, sigma, kind, fc, order, maTaps, q, tone, toneF, inputKind));
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = rng.normal(0, sigma);
    if (tone > 0) {
      for (let i = 0; i < n; i++) x[i] += tone * Math.cos((2 * Math.PI * toneF * i) / FS + 0.7);
    }
    // 输入可选：先经一级低通得到有色噪声（一阶 RC）
    let src: Float64Array = x;
    if (inputKind === 'colored') {
          src = onePoleRc(x, PRE_FC, FS);
      // 重新归一化功率，使 σ 保持口径一致
      const mm = moments(src);
      const g = mm.std > 1e-9 ? sigma / mm.std : 1;
      for (let i = 0; i < src.length; i++) src[i] *= g;
    }
    let y: Float64Array;
        if (kind === 'ma') {
          const taps = Math.max(1, Math.round(maTaps));
          // FIR 滑动平均，中心对齐（补偿群延迟）
          y = new Float64Array(n);
          const delay = Math.floor((taps - 1) / 2);
          for (let i = 0; i < n; i++) {
            let s = 0;
            for (let k = 0; k < taps; k++) {
              const j = i + delay - k;
              if (j >= 0 && j < n) s += src[j];
            }
            y[i] = s / Math.max(1, taps);
          }
        } else if (kind === 'rc') {
              y = onePoleRc(src, fc, FS);
            } else {
              y = applyBiquadCascade(src, cascades);
            }
    return { x: src, y };
  }, [seed, n, sigma, kind, fc, order, maTaps, q, tone, toneF, inputKind, cascades]);

  /* ---------------------------------------------- 频率响应 |H|² */
  const hResp = useMemo(() => {
    const P = 512;
    const freqs = new Float64Array(P);
    const mag = new Float64Array(P);
    const mag2 = new Float64Array(P);
    for (let i = 0; i < P; i++) {
      const f = ((FS / 2) * i) / (P - 1);
      freqs[i] = f;
      const h = magResponse(f);
      mag[i] = h;
      mag2[i] = h * h;
    }
    // 等效噪声带宽
    let sum2 = 0;
    for (let i = 0; i < P; i++) sum2 += mag2[i];
    const mean2 = sum2 / P;
    const peak = Math.max(...Array.from(mag2), 1e-12);
    const bn = (mean2 / peak) * (FS / 2);
    return { freqs, mag, mag2, mean2, bn, peak };
  }, [kind, fc, order, q, maTaps]);

  /* ---------------------------------------------- 谱估计 */
  const spectra = useMemo(() => {
      const grid = new Float64Array(513);
    for (let i = 0; i < grid.length; i++) grid[i] = (i * (FS / 2)) / (grid.length - 1);
    const px = method === 'welch' ? welchPsd(sim.x, FS, 8) : periodogram(sim.x, FS);
    const py = method === 'welch' ? welchPsd(sim.y, FS, 8) : periodogram(sim.y, FS);
      // 直接在原始分辨率的谱上做梯形积分，避免重采样引入的能量损失
      const trapz = (f: Float64Array, v: Float64Array) => {
        let s = 0;
        for (let i = 1; i < f.length; i++) s += ((v[i] + v[i - 1]) / 2) * (f[i] - f[i - 1]);
        return s;
      };
      return {
        freqs: grid,
        sx: resample(px.freqs, px.mag, grid),
        sy: resample(py.freqs, py.mag, grid),
        inPower: trapz(px.freqs, px.mag),
        outPower: trapz(py.freqs, py.mag),
      };
    }, [sim, method]);

  /* ---------------------------------------------- 理论输入谱 */
  // 输入为白噪声时 S_X 平坦；为有色噪声时等于“预整形滤波器”的 |H_pre|² 加权后归一化到总功率 σ²。
  const theoryPsd = useMemo(() => {
    const inVar = sigma * sigma;
    const P = 600;
    const freqs = new Float64Array(P);
    const sx = new Float64Array(P);
    const sy = new Float64Array(P);
    const pre2 = new Float64Array(P);
    let preEnergy = 0;
    const df = FS / 2 / P;
    for (let i = 0; i < P; i++) {
      const f = ((FS / 2) * (i + 0.5)) / P;
      freqs[i] = f;
      pre2[i] = inputKind === 'colored' ? onePoleRcResponse(PRE_FC, FS, f) ** 2 : 1;
      preEnergy += pre2[i] * df;
    }
    let outVar = 0;
    for (let i = 0; i < P; i++) {
      // 预整形滤波器输出总功率归一化为 σ²，故 S_X 的积分恰为 σ²
      sx[i] = (inVar * pre2[i]) / Math.max(1e-12, preEnergy);
      sy[i] = sx[i] * magResponse(freqs[i]) ** 2;
      outVar += sy[i] * df;
    }
    return { freqs, sx, sy, outVar };
  }, [sigma, inputKind, kind, fc, order, maTaps, q]);

  const theory = useMemo(() => {
    const inVar = sigma * sigma;
    const grid = spectra.freqs;
    const tSx = new Float64Array(grid.length);
    const tSy = new Float64Array(grid.length);
    const P = theoryPsd.freqs.length;
    let j = 0;
    for (let i = 0; i < grid.length; i++) {
      const f = grid[i];
      while (j < P - 2 && theoryPsd.freqs[j + 1] < f) j++;
      const k = Math.min(P - 1, j + 1);
      const span = theoryPsd.freqs[k] - theoryPsd.freqs[j] || 1;
      const w = Math.min(1, Math.max(0, (f - theoryPsd.freqs[j]) / span));
      tSx[i] = theoryPsd.sx[j] + (theoryPsd.sx[k] - theoryPsd.sx[j]) * w;
      tSy[i] = theoryPsd.sy[j] + (theoryPsd.sy[k] - theoryPsd.sy[j]) * w;
    }
    return {
      sxFlat: theoryPsd.sx[0],
      tSx,
      tSy,
      outVar: theoryPsd.outVar,
      inVar,
      whitePsd: inVar / (FS / 2),
    };
  }, [spectra, theoryPsd, sigma]);

    /** 带内总功率（Parseval 校验用）：由 ∫₀^{fs/2} S(f) df 得到 */
      const powerCheck = useMemo(
        () => ({
          inPsdPower: spectra.inPower,
          outPsdPower: spectra.outPower,
          theoryOut: theory.outVar,
        }),
        [spectra, theory],
      );

  /* ---------------------------------------------- 自相关（输入/输出/理论） */
  const acf = useMemo(() => {
    const maxLag = Math.min(n / 2, 512);
    const rx = autocorrelation(sim.x, maxLag);
    const ry = autocorrelation(sim.y, maxLag);
        // 理论上：R_Y(τ) = (2σ²/fs)∫₀^{fs/2}|H(f)|²cos(2πfτ)df
        const P = 600;
        const ryTheory = new Float64Array(maxLag + 1);
        const h2 = new Float64Array(P);
        for (let i = 0; i < P; i++) {
          const f = ((FS / 2) * (i + 0.5)) / P;
          const h = magResponse(f);
          h2[i] = h * h;
    }
        const df = FS / 2 / P;
        for (let m = 0; m <= maxLag; m++) {
          const tau = m / FS;
          let s = 0;
          for (let i = 0; i < P; i++) {
            const f = ((FS / 2) * (i + 0.5)) / P;
            s += h2[i] * Math.cos(2 * Math.PI * f * tau) * df;
          }
          ryTheory[m] = ((2 * sigma * sigma) / FS) * s;
        }
        return { rx, ry, ryTheory, maxLag };
    }, [sim, n, sigma, kind, fc, order, maTaps, q]);

  /* ---------------------------------------------- 指标 */
  const mIn = useMemo(() => moments(sim.x), [sim.x]);
  const mOut = useMemo(() => moments(sim.y), [sim.y]);
  // 通带内正弦增益（若注入单音）
  const toneGain = tone > 0 ? magResponse(toneF) : NaN;
  const snrGainDb =
    tone > 0 ? 20 * Math.log10((tone * magResponse(toneF)) / Math.max(1e-9, sigma * Math.sqrt(hResp.mean2))) - 20 * Math.log10(tone / sigma) : NaN;

  /* ---------------------------------------------- 诊断 */
  const diag: DiagItem[] = useMemo(() => {
    const items: DiagItem[] = [];
      const varErr = relError(mOut.variance, theory.outVar);
      const psdErr = relError(powerCheck.outPsdPower, theory.outVar);
      items.push({
        tone: Math.abs(varErr) < 5 ? 'ok' : 'warn',
        title: '输出功率守恒（时域）',
        body: `经验输出方差 ${fmt(mOut.variance, 4)}，理论 ∫S_Y df = ${fmt(theory.outVar, 4)}，误差 ${fmt(varErr, 2)}%。该式即 S_Y = |H|²S_X 积分后的时域等价形式（Parseval）。`,
      });
      items.push({
        tone: Math.abs(psdErr) < 8 ? 'ok' : 'warn',
        title: '输出功率守恒（频域积分）',
        body: `对估计谱做梯形积分得 ${fmt(powerCheck.outPsdPower, 4)}，理论 ${fmt(theory.outVar, 4)}，误差 ${fmt(psdErr, 2)}%。这是对 S_Y = |H|²S_X 更直接的数值验证，且用积分而非单点比较，方差小得多。`,
      });
      items.push({
        tone: 'info',
        title: '等效噪声带宽',
        body: `B_N = ∫|H|²df / |H(0)|² = ${fmt(hResp.bn, 2)} Hz。对白噪声，输出功率 = 输入 PSD × B_N（单边），这就是“滤波把宽带噪声换成窄带噪声”的定量含义。`,
      });
      items.push({
        tone: 'info',
        title: '输入谱为何不平？',
        body:
          method === 'welch'
            ? 'Welch 平均后仍残留约 1/8 的相对方差，平坦谱上会出现 ±10% 起伏；这是估计器方差而非系统失真。'
            : '单段周期图的相对标准差接近 100%，因此“白噪声”看起来剧烈起伏。用 Welch 或增加段数可见谱线趋平。',
      });
    if (kind === 'ma') {
      items.push({
        tone: 'warn',
        title: 'FIR 滑动平均的零点',
        body: `M=${maTaps} 点滑动平均的 |H(f)| 在 f = k·fs/M 处有精确零点；当前 fs/M = ${fmt(FS / maTaps, 1)} Hz，因此谱上会看到周期性凹口（梳状）。`,
      });
    } else if (kind === 'band') {
      items.push({
        tone: 'info',
        title: '带通输出为窄带过程',
        body: `Q = ${q.toFixed(2)}，3dB 带宽约 ${fmt(fc / q, 2)} Hz。时域上输出表现为缓慢变化的包络乘以 cos(2πf_c t)，这正是第四章窄带模型的前提。`,
      });
    }
    if (tone > 0) {
      items.push({
        tone: Math.abs(toneGain) < 0.9 && Math.abs(toneGain) > 0.1 ? 'warn' : 'ok',
        title: '单音通过滤波器',
        body: `注入 ${toneF} Hz 单音，|H(f_tone)| = ${fmt(toneGain, 4)}，输出幅度 ${fmt(tone * toneGain, 4)}。单音只能验证幅度响应，验证相位需看群延迟。`,
      });
    }
    if (acf.ry[0] > 0 && acf.rx[0] > 0) {
      const corrTime = estimateCorrTime(acf.ry, FS, 1 / Math.E);
      items.push({
        tone: 'info',
        title: '输出相关时间',
        body: `输出自相关下降到 R_Y(0)/e 的时延约为 ${fmt(corrTime, 4)} s，输入的相关时间约为 ${fmt(estimateCorrTime(acf.rx, FS, 1 / Math.E), 4)} s。线性滤波在时域上的作用就是把“记忆”拉长到 ≈ 1/B_N。`,
      });
    }
    return items;
      }, [mOut, theory, hResp, method, kind, maTaps, q, fc, tone, toneGain, toneF, acf, powerCheck]);

  /* ---------------------------------------------- 绘图 */
  const drawSystem = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 44, y: 16, w: w - 58, h: h - 54 };
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, FS / 2],
      yDomain: [0, 1.08],
      xLabel: '频率 f / Hz',
      yLabel: '|H(f)|',
      title: '系统幅度响应与 −3dB 截止',
      titleSub: kind === 'ma' ? `FIR M=${maTaps}` : kind === 'band' ? `带通 Q=${q}` : `fc=${fc}Hz 阶数 ${order}`,
    });
    const N = 480;
    const fr = new Float64Array(N);
    const mg = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const f = ((FS / 2) * i) / (N - 1);
      fr[i] = f;
      mg[i] = magResponse(f);
    }
    drawFill(ctx, fr, mg, ax.xs, ax.ys, { fill: ACCENT, alpha: 0.1 });
    drawSeries(ctx, fr, mg, ax.xs, ax.ys, { color: INK, width: 1.4 });
    drawHLine(ctx, Math.SQRT1_2, ax.xs, ax.ys, { color: WARN, dash: [3, 3] });
    drawVLine(ctx, fc, ax.xs, ax.ys, { color: WARN, dash: [2, 4] });
    ctx.save();
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = WARN;
    ctx.textAlign = 'left';
    ctx.fillText(`−3dB`, ax.xs.r0 + 4, ax.ys(Math.SQRT1_2) - 4);
    ctx.restore();
  };

  const drawTime = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 46, y: 16, w: w - 62, h: h - 54 };
      // 只显示约 2/(fc) 秒，令滤波的平滑效应在视觉上可辨
      const view = Math.max(300, Math.min(n, Math.round((22 / Math.max(5, fc)) * FS)));
      const t = new Float64Array(view);
      const xi = new Float64Array(view);
      const yi = new Float64Array(view);
      let scaleIn = 0;
      let scaleOut = 0;
    for (let i = 0; i < view; i++) {
        scaleIn = Math.max(scaleIn, Math.abs(sim.x[i]));
        scaleOut = Math.max(scaleOut, Math.abs(sim.y[i]));
      }
      const lim = Math.max(scaleIn, scaleOut) * 1.05;
      for (let i = 0; i < view; i++) {
        t[i] = i / FS;
        xi[i] = sim.x[i];
        yi[i] = sim.y[i];
      }
      const ax = drawAxes(ctx, rect, {
        xDomain: [0, view / FS],
        yDomain: [-lim, lim],
        xLabel: '时间 t / s',
        yLabel: '幅值',
        title: '输入 / 输出波形对比',
        titleSub: `fs=${FS}Hz · 显示 ${view} 点`,
      });
    drawSeries(ctx, t, xi, ax.xs, ax.ys, { color: '#cbd5e1', width: 0.9 });
    drawSeries(ctx, t, yi, ax.xs, ax.ys, { color: ACCENT, width: 1.2 });
  };

  const drawPsd = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 52, y: 16, w: w - 68, h: h - 54 };
        const floorDb = -110;
        const toDb = (v: number) => 10 * Math.log10(Math.max(v, 1e-12));
        let peak = 0;
        for (let i = 0; i < spectra.freqs.length; i++) peak = Math.max(peak, spectra.sx[i], spectra.sy[i]);
        const topDb = toDb(peak);
        // 纵轴只覆盖有效动态范围；更低的谱值靠裁剪自然出界，而不是压成一条假的噪声底
        const yTop = logScale ? Math.ceil((topDb + 12) / 5) * 5 : peak * 1.15;
        const yBot = logScale ? Math.max(floorDb, yTop - 60) : 0;
        const clampDb = (v: number) => Math.max(floorDb, toDb(v));
        const ax = drawAxes(ctx, rect, {
          xDomain: [0, FS / 2],
          yDomain: [yBot, yTop],
          xLabel: '频率 f / Hz',
          yLabel: logScale ? 'PSD / dB' : 'PSD  幅值²/Hz',
          title: '输入 / 输出功率谱密度',
          titleSub: `${method === 'welch' ? 'Welch 8 段' : '周期图'} · S_Y=|H|²S_X`,
        });
        const mapArr = (a: Float64Array) => {
          if (!logScale) return a;
          const o = new Float64Array(a.length);
          for (let i = 0; i < a.length; i++) o[i] = toDb(a[i]);
          return o;
        };
        const sxV = mapArr(spectra.sx);
        const syV = mapArr(spectra.sy);
        const tyV = mapArr(theory.tSy);
        if (!logScale) drawFill(ctx, spectra.freqs, theory.tSy, ax.xs, ax.ys, { fill: ACCENT, alpha: 0.12 });
        drawSeries(ctx, spectra.freqs, sxV, ax.xs, ax.ys, { color: '#94a3b8', width: 1 });
        drawSeries(ctx, spectra.freqs, syV, ax.xs, ax.ys, { color: ACCENT, width: 1.1 });
        drawSeries(ctx, spectra.freqs, tyV, ax.xs, ax.ys, { color: INK, width: 1.2, dash: [5, 3] });
        if (showH) {
          const N = 400;
          const fr = new Float64Array(N);
          const hv = new Float64Array(N);
          const hMax = Math.max(...Array.from(theory.tSy), 1e-12);
          for (let i = 0; i < N; i++) {
            const f = ((FS / 2) * i) / (N - 1);
            fr[i] = f;
            // 以理论输出谱峰值为参考，把 |H|² 叠加在同一坐标中
            const v = (magResponse(f) ** 2) * hMax * 0.8;
            hv[i] = logScale ? clampDb(v) : v;
          }
          drawSeries(ctx, fr, hv, ax.xs, ax.ys, { color: WARN, width: 1, dash: [2, 3] });
        }
        // 输入白噪声的理论单边 PSD 参考线
        if (logScale) drawHLine(ctx, toDb(theory.whitePsd), ax.xs, ax.ys, { color: '#cbd5e1', dash: [1, 3] });
          };

  const drawAcf = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 48, y: 16, w: w - 64, h: h - 54 };
      // 自适应时延上限：约 8 倍输出相关时间 1/(2B_N)，否则曲线会被压成一条竖线
      const tauMax = Math.min(acf.maxLag / FS, Math.max(0.004, 6 / (2 * Math.max(1, hResp.bn))));
      const lagMax = Math.max(8, Math.min(acf.maxLag, Math.round(tauMax * FS)));
      let peak = 0;
      for (let m = 0; m <= lagMax; m++) peak = Math.max(peak, acf.rx[m], acf.ry[m], acf.ryTheory[m]);
      const ax = drawAxes(ctx, rect, {
        xDomain: [0, lagMax / FS],
        yDomain: [-0.28 * peak, peak * 1.08],
        xLabel: '时延 τ / s',
        yLabel: 'R(τ)',
        title: '自相关函数传递',
        titleSub: `窗口 ${((lagMax / FS) * 1000).toFixed(1)} ms`,
      });
    const tau = new Float64Array(lagMax + 1);
    for (let m = 0; m <= lagMax; m++) tau[m] = m / FS;
    drawSeries(ctx, tau, acf.rx.subarray(0, lagMax + 1), ax.xs, ax.ys, { color: '#cbd5e1', width: 1 });
    drawSeries(ctx, tau, acf.ry.subarray(0, lagMax + 1), ax.xs, ax.ys, { color: ACCENT, width: 1.2 });
    drawSeries(ctx, tau, acf.ryTheory.subarray(0, lagMax + 1), ax.xs, ax.ys, {
      color: INK,
      width: 1.1,
      dash: [4, 3],
    });
  };

  /* ---------------------------------------------- 渲染 */
  return (
    <Workbench
      controls={
        <>
          <ControlHead chapter="模块 03 / CH.3" name="线性系统响应" />
          <FieldGroup title="系统类型">
            <Segmented
              options={[
                { value: 'butter', label: '巴特沃斯低通' },
                { value: 'rc', label: '一阶 RC' },
                { value: 'ma', label: 'FIR 滑动平均' },
                { value: 'band', label: '带通' },
              ]}
              columns={2}
              value={kind}
              onChange={(v) => setKind(v as FilterKind)}
            />
          </FieldGroup>
          <FieldGroup title="系统参数">
            <Slider label="截止频率" symbol="f_c" value={fc} min={10} max={600} step={5} digits={0} unit="Hz" onChange={setFc} />
            {kind === 'butter' && (
              <Slider label="阶数" symbol="n" value={order} min={2} max={12} step={2} digits={0} onChange={setOrder} />
            )}
            {kind === 'ma' && (
              <Slider label="抽头数" symbol="M" value={maTaps} min={2} max={64} step={1} digits={0} onChange={setMaTaps} />
            )}
            {kind === 'band' && (
              <Slider label="品质因数" symbol="Q" value={q} min={0.5} max={12} step={0.1} onChange={setQ} />
            )}
          </FieldGroup>
          <FieldGroup title="输入信号">
            <Segmented
              options={[
                { value: 'white', label: '白噪声' },
                { value: 'colored', label: '有色噪声' },
              ]}
              columns={2}
              value={inputKind}
              onChange={(v) => setInputKind(v as InputKind)}
            />
            <Slider label="输入标准差" symbol="σ" value={sigma} min={0.1} max={2} step={0.05} onChange={setSigma} />
            <Slider label="单音幅度" value={tone} min={0} max={2} step={0.05} onChange={setTone} hint=">0 时叠加正弦以测量通带增益" />
            {tone > 0 && (
              <Slider label="单音频率" value={toneF} min={5} max={800} step={5} digits={0} unit="Hz" onChange={setToneF} />
            )}
          </FieldGroup>
          <FieldGroup title="谱估计与规模">
            <Segmented
              options={[
                { value: 'welch', label: 'Welch' },
                { value: 'periodogram', label: '周期图' },
              ]}
              columns={2}
              value={method}
              onChange={(v) => setMethod(v as SpecMethod)}
            />
            <Slider label="样本数" symbol="N" value={n} min={1024} max={32768} step={1024} digits={0} onChange={setN} />
            <Toggle label="叠加 |H|² 参考曲线" checked={showH} onChange={setShowH} />
            <Toggle label="对数坐标（dB）" hint="白噪声动态范围大，对数轴更易观察整形" checked={logScale} onChange={setLogScale} />
            <div className="flex gap-1 px-3 pb-2 pt-1">
              <Button variant="primary" className="flex-1" onClick={() => setSeed((s) => s + 15486)}>
                重新生成噪声
              </Button>
            </div>
            <div className="px-3 pb-2">
              <span className="num text-[9px] text-slate-400">
                SEED={seed} · T={duration.toFixed(2)}s · Δf={fmt(FS / n, 3)}Hz
              </span>
            </div>
          </FieldGroup>
        </>
      }
      center={
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.15fr_1fr]">
            <Figure
              code="A"
              title="系统幅度响应"
              meta={`fc = ${fc} Hz`}
              height={222}
              draw={drawSystem}
              deps={[kind, fc, order, q, maTaps]}
                            legend={[
                              { label: '|H(f)|', color: INK },
                              { label: '−3dB 线', color: WARN, dash: true },
                            ]}
                          />
            <Panel code="B" title="系统与信号指标" bodyClass="">
              <div className="px-3 pb-1 pt-2">
                <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">频域</div>
                <StatTable
                  compact
                  rows={[
                                      { label: '输入谱积分', symbol: '∫Ŝ_X df', empirical: powerCheck.inPsdPower, theoretical: theory.inVar, digits: 4 },
                                      { label: '输出谱积分', symbol: '∫Ŝ_Y df', empirical: powerCheck.outPsdPower, theoretical: theory.outVar, digits: 4 },
                                      { label: '等效噪声带宽', symbol: 'B_N', empirical: NaN, theoretical: hResp.bn, digits: 2 },
                  ]}
                />
              </div>
              <div className="border-t border-[#f1f5f9] px-3 pb-1 pt-1.5">
                <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">时域</div>
                <StatTable
                  compact
                  rows={[
                    { label: '输入方差', symbol: 'σ_X²', empirical: mIn.variance, theoretical: theory.inVar, digits: 4 },
                    { label: '输出方差', symbol: 'σ_Y²', empirical: mOut.variance, theoretical: theory.outVar, digits: 4 },
                    { label: '输出功率增益', symbol: 'G_p', empirical: mOut.variance / Math.max(1e-12, mIn.variance), theoretical: theory.outVar / theory.inVar, digits: 4 },
                  ]}
                />
                {tone > 0 && (
                  <div className="mt-1.5 border-t border-[#f1f5f9] pt-1.5">
                    <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">单音增益</div>
                    <StatTable
                      compact
                      rows={[
                        { label: '通带幅度增益', symbol: '|H|', empirical: NaN, theoretical: toneGain, digits: 4 },
                        { label: '信噪比改善', symbol: 'ΔSNR', empirical: NaN, theoretical: snrGainDb, digits: 2 },
                      ]}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 border-t border-hairline bg-panel px-3 py-[4px]">
                              <Badge tone={Math.abs(relError(mOut.variance, theory.outVar)) < 5 ? 'ok' : 'warn'}>
                                {Math.abs(relError(mOut.variance, theory.outVar)) < 5 ? '功率一致' : '方差偏差'}
                </Badge>
                <span className="num text-[9px] text-slate-400">
                                σ_Y² 误差 {fmt(relError(mOut.variance, theory.outVar), 2)}%
                </span>
                              <span className="num ml-auto text-[9px] text-slate-400">
                                BN/fs = {(hResp.bn / FS).toFixed(3)}
                              </span>
                            </div>
            </Panel>
          </div>
          <Figure
            code="C"
            title="双谱对照：S_X(f) 与 S_Y(f) = |H(f)|²S_X(f)"
            meta={`${method === 'welch' ? 'Welch' : '周期图'} · N=${n}`}
            height={252}
            draw={drawPsd}
            deps={[spectra, theory, method, showH, kind, fc, order, maTaps, q, logScale]}
                        legend={[
                          { label: 'Ŝ_X(f)', color: '#94a3b8' },
                          { label: 'Ŝ_Y(f)', color: ACCENT },
                          { label: '|H|²S_X 理论', color: INK, dash: true },
                          ...(showH ? [{ label: '|H|²（缩放）', color: WARN, dash: true }] : []),
                          ...(logScale ? [{ label: '输入 PSD 参考', color: '#cbd5e1', dash: true }] : []),
                        ]}
                        note={
              <>
                灰色为输入白噪声谱（近似平坦），蓝色为输出谱，黑色虚线是理论整形结果。系统把平坦的白噪声
                “雕刻”成 |H|² 的形状——这就是频域乘法的可视化。
              </>
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Figure
              code="D"
              title="时域输入 / 输出"
              meta="滤波后明显平滑"
              height={212}
              draw={drawTime}
              deps={[sim, n, fc]}
                            legend={[
                              { label: '输入 X(t)', color: '#cbd5e1' },
                              { label: '输出 Y(t)', color: ACCENT },
                            ]}
                          />
            <Figure
              code="E"
              title="自相关传递"
              meta="R_Y = R_X * h * h(−τ)"
              height={212}
              draw={drawAcf}
              deps={[acf, hResp]}
                            legend={[
                              { label: 'R̂_X(τ)', color: '#cbd5e1' },
                              { label: 'R̂_Y(τ)', color: ACCENT },
                              { label: '理论 R_Y(τ)', color: INK, dash: true },
                            ]}
                          />
          </div>
        </>
      }
      right={
        <>
          <FormulaCard
            items={[
              {
                label: '输出功率谱密度',
                tex: String.raw`S_Y(\omega)=\left|H(\omega)\right|^2 S_X(\omega)`,
                note:
                  inputKind === 'white'
                    ? `输入为白噪声时 S_X = N₀/2 = ${fmt(theory.whitePsd, 5)}`
                    : `输入为有色噪声（一阶 RC, f_c=${PRE_FC} Hz），总功率归一化为 σ_X² = ${fmt(
                        theory.inVar,
                        4,
                      )}`,
              },
              {
                label: '时域相关传输',
                tex: String.raw`R_Y(\tau)=R_X(\tau)*h(\tau)*h(-\tau),\quad R_{XY}(\tau)=R_X(\tau)*h(-\tau)`,
              },
              {
                label: '输出平均功率',
                tex: String.raw`E[Y^2]=\frac{1}{2\pi}\int_{-\infty}^{\infty}|H(\omega)|^2S_X(\omega)\,d\omega=\sigma_X^2\cdot\frac{1}{f_s}\int_0^{f_s/2}|H|^2\cdot2\,df`,
                note: `当前理论输出功率 ${fmt(theory.outVar, 4)}`,
              },
              {
                label: '等效噪声带宽',
                tex: String.raw`B_N=\frac{\int_0^{\infty}|H(f)|^2df}{|H(0)|^2}=${fmt(hResp.bn, 2)}\ \text{Hz}`,
              },
              kind === 'ma'
                ? {
                    label: 'FIR 滑动平均的频响',
                    tex: String.raw`H(f)=\frac{1}{M}\frac{\sin(\pi fM/f_s)}{\sin(\pi f/f_s)}e^{-j\pi f(M-1)/f_s}`,
                    note: `M = ${maTaps}，零点间隔 ${fmt(FS / maTaps, 1)} Hz`,
                  }
                : {
                    label: '一阶 RC 低通（解析）',
                    tex: String.raw`|H(\omega)|^2=\frac{1}{1+(\omega/\omega_c)^2},\quad B_N=\frac{\pi}{2}f_c`,
                    note: kind === 'rc' ? `πf_c/2 = ${fmt((Math.PI / 2) * fc, 2)} Hz` : '高阶滤波器带宽更接近 f_c',
                  },
            ]}
          />
          <DiagnosisPanel
            items={diag}
            verdict={Math.abs(relError(mOut.variance, theory.outVar)) < 8 ? '谱映射校验通过' : '存在偏差'}
            verdictTone={Math.abs(relError(mOut.variance, theory.outVar)) < 8 ? 'ok' : 'warn'}
            state={{
              module: 'lti/psd-mapping',
              filter: { kind, fc, order: kind === 'butter' ? order : undefined, taps: kind === 'ma' ? maTaps : undefined, Q: kind === 'band' ? q : undefined },
              input: { kind: inputKind, sigma, tone, toneF, fs: FS, N: n },
              empirical: { inputVariance: mIn.variance, outputVariance: mOut.variance, peakOutPsd: Math.max(...Array.from(spectra.sy)) },
              theoretical: { outputVariance: theory.outVar, equivalentNoiseBandwidth: hResp.bn, inputPsd: theory.whitePsd, inputVariance: theory.inVar },
              estimator: method,
            }}
          />
          <Steps
            items={[
              {
                q: '为什么输出谱必须等于 |H|²S_X？',
                a: '线性时不变系统对每个频率分量只改变幅度与相位：Y(f) = H(f)X(f)。功率谱是 |X(f)|² 的统计平均，故 S_Y = |H|²S_X。相位信息在取模平方后丢失，因此两个相位不同的系统可以有相同输出谱。',
              },
              {
                q: '白噪声通过低通后还是白的吗？',
                a: '不是。严格的白噪声要求 S_X 在所有频率为常数，输出被 |H|² 加权后成为有色噪声，其自相关不再是 δ 函数，而是 h*h(−τ) 的形状。',
              },
              {
                q: '输出方差不等于输入方差乘以 |H(0)|²？',
                a: '|H(0)|² 只给出直流增益。输出功率需要对整个 |H|² 加权积分。只有当输入为白噪声且系统带宽远小于采样带宽时，才有 σ_Y² ≈ σ_X²·(2B_N/fs)。',
              },
              {
                q: '为什么输出自相关变宽了？',
                a: '时域上输出是输入与 h 的卷积，等效于“记忆”被拉长。相关时间与带宽成反比：τ_c ≈ 1/(2B_N)，这也是时频不确定性原理在随机过程中的体现。',
              },
            ]}
          />
        </>
      }
    />
  );
}

function estimateCorrTime(r: Float64Array, fs: number, level = 0.368): number {
  if (r.length < 2 || r[0] <= 0) return NaN;
  const target = r[0] * level;
  for (let i = 1; i < r.length; i++) {
    if (r[i] <= target) {
      const prev = r[i - 1];
      const cur = r[i];
      const t = prev === cur ? 0 : (prev - target) / (prev - cur);
      return (i - 1 + t) / fs;
    }
  }
  return NaN;
}