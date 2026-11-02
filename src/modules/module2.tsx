import React, { useMemo, useState } from 'react';
import { createRng, seedFrom } from '../lib/rng';
import { fmt, moments, relError, robustRange } from '../lib/math';
import {
  autocorrelation,
  periodogram,
  resample,
  sinusoidPsdExpectation,
  welchPsd,
} from '../lib/dsp';
import {
  ACCENT,
  INK,
  MUTED,
  TRACE,
  WARN,
  drawAxes,
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

type Model = 'phase' | 'ar1';
type Estimator = 'biased' | 'unbiased' | 'welch';

const FS = 400; // 采样率 Hz

export default function Module2() {
  const [model, setModel] = useState<Model>('phase');
  const [amp, setAmp] = useState(1);
  const [f0, setF0] = useState(40);
  const [noise, setNoise] = useState(0.35);
  const [rho, setRho] = useState(0.9);
  const [M, setM] = useState(28);
  const [N, setN] = useState(2048);
  const [t0, setT0] = useState(0.32);
  const [dc, setDc] = useState(false);
  const [seed, setSeed] = useState(2024);
  const [est, setEst] = useState<Estimator>('biased');
  const [highlight, setHighlight] = useState(0);

  const duration = N / FS;

  /* ------------------------------------------------ 生成样本集合 */
  const sim = useMemo(() => {
    const rng = createRng(seedFrom(seed, M, N, model, amp, f0, noise, rho, dc ? 1 : 0));
    const traces: Float64Array[] = [];
    const thetas = new Float64Array(M);
    const dcOffsets = new Float64Array(M);
    const t = new Float64Array(N);
    for (let i = 0; i < N; i++) t[i] = i / FS;

    let arState = 0;
    const arSigma = Math.sqrt(1 - rho * rho);

    for (let m = 0; m < M; m++) {
      const x = new Float64Array(N);
      const theta = rng.uniform() * 2 * Math.PI;
      thetas[m] = theta;
      const b = dc ? rng.normal(0, 1) * Math.max(0.15, amp) : 0;
      dcOffsets[m] = b;
      if (model === 'phase') {
        for (let i = 0; i < N; i++) {
          const nz = rng.normal(0, noise);
          x[i] = amp * Math.cos(2 * Math.PI * f0 * t[i] + theta) + nz + b;
        }
      } else {
        // Gauss–Markov：x[n] = ρx[n-1] + σ√(1-ρ²)w[n]，方差归一后再缩放
        arState = rng.normal(0, 1);
        for (let i = 0; i < N; i++) {
          arState = rho * arState + arSigma * rng.normal(0, 1);
          x[i] = amp * arState + noise * rng.normal(0, 1) + b;
        }
      }
      traces.push(x);
    }
    return { traces, thetas, dcOffsets, t };
  }, [seed, M, N, model, amp, f0, noise, rho, dc]);

  /* ------------------------------------------------ 集合切片 / 时间平均 */
  const stats = useMemo(() => {
    const idx = Math.min(N - 1, Math.max(0, Math.round(t0 * FS)));
    const ensemble = new Float64Array(M);
    for (let m = 0; m < M; m++) ensemble[m] = sim.traces[m][idx];
    const em = moments(ensemble);
    const timeMeans = new Float64Array(M);
    const timeVars = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      const mm = moments(sim.traces[m]);
      timeMeans[m] = mm.mean;
      timeVars[m] = mm.variance;
    }
    const tm = moments(timeMeans);
    const tv = moments(timeVars);
    const all = new Float64Array(M * N);
    for (let m = 0; m < M; m++) all.set(sim.traces[m], m * N);
    const pooled = moments(all);
    return { idx, ensemble, em, timeMeans, timeVars, tm, tv, pooled };
  }, [sim, N, M, t0]);

  /* ------------------------------------------------ 自相关（多样本平均） */
  const maxLag = Math.floor(N / 2);
  const acf = useMemo(() => {
    const acc = new Float64Array(maxLag + 1);
    for (let m = 0; m < M; m++) {
      const r = autocorrelation(sim.traces[m], maxLag);
      for (let lag = 0; lag <= maxLag; lag++) acc[lag] += r[lag] / M;
    }
    // 无偏修正
    if (est === 'unbiased') {
      for (let lag = 0; lag <= maxLag; lag++) acc[lag] *= N / Math.max(1, N - lag);
    }
    return acc;
  }, [sim, M, N, maxLag, est]);

  /* ------------------------------------------------ 理论自相关 */
  const acfTheory = useMemo(() => {
    const out = new Float64Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      const tau = lag / FS;
      if (model === 'phase') {
        out[lag] = (amp * amp) / 2 * Math.cos(2 * Math.PI * f0 * tau) + (lag === 0 ? noise * noise : 0);
      } else {
        // AR(1) 方差 = amp²/(1-ρ²) 由于递推已归一化，这里 amp² 为方差
        out[lag] = amp * amp * Math.pow(rho, lag) + (lag === 0 ? noise * noise : 0);
      }
      if (dc) out[lag] += Math.max(0.15, amp) ** 2;
    }
    return out;
  }, [model, amp, f0, noise, rho, maxLag, dc]);

  /* ------------------------------------------------ 功率谱 */
  const psd = useMemo(() => {
    const grid = new Float64Array(257);
    for (let i = 0; i < grid.length; i++) grid[i] = (i * (FS / 2)) / (grid.length - 1);
    const acc = new Float64Array(grid.length);
    for (let m = 0; m < M; m++) {
      const spec = est === 'welch' ? welchPsd(sim.traces[m], FS, 8) : periodogram(sim.traces[m], FS);
      const r = resample(spec.freqs, spec.mag, grid);
      for (let i = 0; i < grid.length; i++) acc[i] += r[i] / M;
    }
    return { freqs: grid, mag: acc };
  }, [sim, M, est]);

  const psdTheory = useMemo(() => {
    const out = new Float64Array(psd.freqs.length);
      const n0 = (noise * noise) / (FS / 2);
      // 与估计器一致的频率分辨率：周期图为 N 点，Welch 为 N/8 点（50% 重叠 Hann）
      const segLen = est === 'welch' ? Math.max(32, Math.floor(N / 8)) : N;
      if (model === 'phase') {
        const line = sinusoidPsdExpectation(amp, f0, FS, segLen, est === 'welch', psd.freqs);
        for (let i = 0; i < out.length; i++) out[i] = line[i] + n0;
        if (dc) {
          const dcline = sinusoidPsdExpectation(Math.max(0.15, amp) * Math.SQRT2, 0, FS, segLen, est === 'welch', psd.freqs);
          for (let i = 0; i < out.length; i++) out[i] += dcline[i];
        }
      } else {
        const r = rho;
        const a2 = amp * amp;
        for (let i = 0; i < out.length; i++) {
          const f = psd.freqs[i];
          const num = a2 * (1 - r * r);
          out[i] = num / (1 - 2 * r * Math.cos((2 * Math.PI * f) / FS) + r * r) / (FS / 2) + n0;
        }
      }
      return out;
    }, [psd, model, amp, f0, noise, rho, dc, est, N]);

  /* ------------------------------------------------ 诊断 */
  const theory = useMemo(() => {
    if (model === 'phase') {
      return { mean: 0, variance: (amp * amp) / 2 + noise * noise, r0: (amp * amp) / 2 + noise * noise };
    }
    return { mean: 0, variance: amp * amp + noise * noise, r0: amp * amp + noise * noise };
  }, [model, amp, noise]);

  const ergMeanDiff = Math.abs(stats.tm.mean - stats.em.mean);
  const isErgodic = !dc && ergMeanDiff < 0.35 * Math.max(0.3, Math.sqrt(theory.variance / Math.sqrt(N)));
  const timeAvgSpread = stats.tm.std;

  const diag: DiagItem[] = useMemo(() => {
    const items: DiagItem[] = [];
    const eMean = stats.em.mean;
    const tMean = stats.tm.mean;
    if (dc) {
      items.push({
        tone: 'bad',
        title: '均值遍历性已被破坏',
        body: `每个实现叠加了固定随机直流 B_m ~ N(0, ${fmt(Math.max(0.15, amp), 2)}²)。集合均值随 M 增大收敛到 0，而单条轨道的时间平均收敛到各自的 B_m，两者不相等，故平稳但非均值遍历。`,
      });
    } else {
      items.push({
        tone: 'ok',
        title: '集合平均 ≈ 时间平均',
        body: `集合均值 ${fmt(eMean, 4)}（在 t₀ 处切片，M=${M}），时间平均 ${fmt(tMean, 4)}（对 ${M} 条轨道平均）。差值 ${fmt(Math.abs(eMean - tMean), 4)} 处于 √(R_X(0)/T) 的抽样量级内，符合均值遍历性。`,
      });
    }
    items.push({
      tone: 'info',
          title: '集合统计量的抽样不确定度',
          body: `t₀ 处的方差由 M = ${M} 个样本估计，其相对标准差约 √(2/(M−1)) = ${((Math.sqrt(2 / Math.max(1, M - 1)) * 100) | 0)}%，因此 −20% 量级的偏差属于正常波动；增加 M 或改看全样本方差（${fmt(stats.pooled.variance, 4)}）能得到更稳的估计。`,
    });
        items.push({
          tone: 'info',
          title: '单条轨道的时间平均存在散布',
          body: `M 条轨道时间平均的标准差为 ${fmt(timeAvgSpread, 4)}，约为 √(R_X(0)/(T·B_eff))。教学要点：遍历性只保证“以概率 1 收敛”，不保证每一条轨道都精确相等。`,
        });
    const r0err = Math.abs(relError(acf[0], theory.r0));
    items.push({
      tone: r0err < 8 ? 'ok' : 'warn',
      title: '自相关零点值 = 平均功率',
      body: `R̂_X[0] = ${fmt(acf[0], 4)}，理论 E[X²] = ${fmt(theory.r0, 4)}，误差 ${r0err.toFixed(2)}%。这是随机过程最重要的守恒关系之一。`,
    });
    if (model === 'phase') {
      items.push({
        tone: 'info',
        title: '随机相位正弦的自相关',
        body: `R_X(τ) = (A²/2)cos(ω₀τ) = ${fmt((amp * amp) / 2, 3)}·cos(2π·${f0}τ)。Θ 均匀分布抹掉了初相位，使过程广义平稳；若 Θ 固定，R_X 将依赖 t。`,
      });
    } else {
      items.push({
        tone: 'info',
        title: 'AR(1) 的相关时间',
        body: `ρ = ${rho.toFixed(2)}，相关时间 τ_c = -1/(FS·ln ρ) = ${fmt(-1 / (FS * Math.log(Math.max(1e-6, rho))), 4)} s。ρ → 1 时谱峰集中在直流附近，估计方差显著增大。`,
      });
    }
    items.push({
      tone: 'info',
      title: est === 'welch' ? 'Welch 法的偏差-方差折衷' : '周期图的一致性问题',
      body:
        est === 'welch'
          ? 'Welch 把 N 点分成 8 段 50% 重叠的 Hann 窗片段，方差约降低为 1/8，代价是频率分辨率由 FS/N 降为 2FS/N。'
          : '单个周期图不是一致估计：N → ∞ 时方差不趋于 0（约等于 PSD²）。因此谱曲线始终呈现明显毛刺，需分段平均（Welch）平滑。',
    });
    return items;
  }, [stats, acf, theory, model, amp, f0, rho, dc, M, N, est, timeAvgSpread]);

  /* ------------------------------------------------ 绘图 */
  const drawTraces = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 42, y: 16, w: w - 58, h: h - 54 };
    const [ylo, yhi] = robustRange(sim.traces[highlight], 0.002, 0.998);
    const pad = (yhi - ylo) * 0.12;
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, duration],
      yDomain: [ylo - pad, yhi + pad],
      xLabel: '时间 t / s',
      yLabel: 'X(t)',
      title: '样本函数集合（随机相位正弦 + 噪声）',
      titleSub: `M=${M} · N=${N} · fs=${FS}Hz`,
    });
    // 全部轨道
    for (let m = 0; m < M; m++) {
      if (m === highlight) continue;
      drawSeries(ctx, sim.t, sim.traces[m], ax.xs, ax.ys, {
        color: m % 2 === 0 ? '#cbd5e1' : '#e2e8f0',
        width: 1,
        alpha: 0.85,
      });
    }
    drawSeries(ctx, sim.t, sim.traces[highlight], ax.xs, ax.ys, { color: ACCENT, width: 1.4 });
    // t0 切片
    drawVLine(ctx, t0, ax.xs, ax.ys, { color: WARN, dash: [3, 3], label: `t₀=${t0.toFixed(2)}s` });
    // 切片点
    ctx.save();
    ctx.fillStyle = WARN;
    for (let m = 0; m < M; m++) {
      ctx.beginPath();
      ctx.arc(ax.xs(t0), ax.ys(stats.ensemble[m]), 2.1, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
    drawHLine(ctx, stats.em.mean, ax.xs, ax.ys, { color: INK, dash: [5, 3], width: 1 });
    ctx.save();
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.fillText(`⟨x(t₀)⟩ = ${fmt(stats.em.mean, 4)}`, ax.xs.r0 + 4, ax.ys(stats.em.mean) - 4);
    ctx.restore();
  };

  const drawSlice = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
        const rect = { x: 44, y: 16, w: w - 60, h: h - 54 };
        const [lo, hi] = robustRange(stats.ensemble, 0.02, 0.98);
        const ax = drawAxes(ctx, rect, {
          xDomain: [lo, hi],
          yDomain: [-1, M],
          xLabel: 'X(t₀) 取值',
          yLabel: '轨道 m',
          title: `固定时刻 t₀ = ${t0.toFixed(2)} s 的集合切片`,
          titleSub: `M = ${M} 个随机变量`,
          xTickCount: 5,
          yTickCount: 4,
        });
        ctx.save();
        for (let m = 0; m < M; m++) {
          ctx.fillStyle = m === highlight ? ACCENT : '#94a3b8';
          ctx.beginPath();
          ctx.arc(ax.xs(stats.ensemble[m]), ax.ys(M - 1 - m), m === highlight ? 3 : 2.2, 0, 6.2832);
          ctx.fill();
        }
        ctx.restore();
        drawVLine(ctx, stats.em.mean, ax.xs, ax.ys, { color: INK, dash: [4, 3] });
        drawVLine(ctx, stats.tm.mean, ax.xs, ax.ys, { color: ACCENT, dash: [2, 3] });
    };

  const drawAcf = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 46, y: 16, w: w - 62, h: h - 54 };
    const lagMax = Math.min(maxLag, Math.round(0.16 * FS * 4));
    const taus = new Float64Array(lagMax + 1);
    const emp = new Float64Array(lagMax + 1);
    const thy = new Float64Array(lagMax + 1);
    for (let i = 0; i <= lagMax; i++) {
      taus[i] = i / FS;
      emp[i] = acf[i];
      thy[i] = acfTheory[i];
    }
    const [lo, hi] = robustRange(Array.from(emp).concat(Array.from(thy)), 0.001, 0.999);
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, lagMax / FS],
      yDomain: [Math.min(lo, 0) - 0.1 * Math.abs(hi), hi * 1.08],
      xLabel: '时延 τ / s',
      yLabel: 'R_X(τ)',
      title: '自相关估计与理论曲线',
      titleSub: `${est === 'unbiased' ? '无偏' : '有偏'}估计 · M 条轨道平均`,
    });
    drawSeries(ctx, taus, emp, ax.xs, ax.ys, { color: TRACE, width: 1.6 });
    drawSeries(ctx, taus, thy, ax.xs, ax.ys, { color: ACCENT, width: 1.3, dash: [5, 3] });
    drawHLine(ctx, 0, ax.xs, ax.ys, { color: '#cbd5e1', dash: [], width: 0.9 });
  };

  const drawPsd = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 50, y: 16, w: w - 66, h: h - 54 };
    const fMax = Math.min(FS / 2, Math.max(120, 4 * f0));
    let peak = 0;
    for (let i = 0; i < psd.freqs.length; i++) {
      if (psd.freqs[i] <= fMax) peak = Math.max(peak, psd.mag[i], psdTheory[i]);
    }
    const ax = drawAxes(ctx, rect, {
      xDomain: [0, fMax],
      yDomain: [0, peak * 1.15],
      xLabel: '频率 f / Hz',
      yLabel: 'S_X(f)  幅值²/Hz',
      title: '单边功率谱密度估计',
      titleSub: est === 'welch' ? 'Welch · 8 段 Hann' : '周期图 · 单段',
    });
    const fr: number[] = [];
    const mag: number[] = [];
    const thy: number[] = [];
    for (let i = 0; i < psd.freqs.length; i++) {
      if (psd.freqs[i] <= fMax) {
        fr.push(psd.freqs[i]);
        mag.push(psd.mag[i]);
        thy.push(psdTheory[i]);
      }
    }
    drawSeries(ctx, Float64Array.from(fr), Float64Array.from(mag), ax.xs, ax.ys, {
      color: TRACE,
      width: 1.1,
    });
    drawSeries(ctx, Float64Array.from(fr), Float64Array.from(thy), ax.xs, ax.ys, {
      color: ACCENT,
      width: 1.3,
      dash: [5, 3],
    });
    if (model === 'phase') {
      drawVLine(ctx, f0, ax.xs, ax.ys, { color: WARN, dash: [2, 3], label: `f₀=${f0}Hz` });
    }
  };

  const drawHistSlice = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const rect = { x: 42, y: 16, w: w - 58, h: h - 54 };
    const [lo, hi] = robustRange(stats.ensemble, 0.01, 0.99);
    const bins = 14;
    const width = (hi - lo) / bins || 1;
    const counts = new Float64Array(bins);
    for (let m = 0; m < M; m++) {
      const i = Math.floor((stats.ensemble[m] - lo) / width);
      if (i >= 0 && i < bins) counts[i]++;
    }
    const dens = counts.map((c) => c / (M * width));
      let peak = Math.max(...Array.from(dens), 1e-9);
      // 无噪正弦的反正弦密度在 |v|→A 处发散，需先裁到绘图区间内再定上限，
      // 否则理论曲线的渐近尾部会把整幅图压扁。
      const arcsine = (v: number) =>
        model === 'phase' && !dc && Math.abs(v) < amp ? 1 / (Math.PI * Math.sqrt(Math.max(1e-9, amp * amp - v * v))) : 0;
      const clipLo = Math.max(lo, -amp * 0.985);
      const clipHi = Math.min(hi, amp * 0.985);
      if (clipHi > clipLo) {
        for (let i = 0; i <= 40; i++) peak = Math.max(peak, arcsine(clipLo + ((clipHi - clipLo) * i) / 40));
      }
      const ax = drawAxes(ctx, rect, {
        xDomain: [lo, hi],
        yDomain: [0, peak * 1.15],
        xLabel: '一阶密度 f_X(x; t₀)',
        yLabel: 'f_X',
        title: '集合切片的一阶概率密度',
        titleSub: `M=${M} · ${bins} 箱`,
        yTickCount: 4,
      });
    ctx.save();
    ctx.fillStyle = '#dbeafe';
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 0.7;
    for (let i = 0; i < bins; i++) {
      const left = ax.xs(lo + i * width) + 0.3;
      const right = ax.xs(lo + (i + 1) * width) - 0.3;
      const top = ax.ys(dens[i]);
      const base = ax.ys(0);
      ctx.fillRect(left, top, Math.max(0.5, right - left), base - top);
      ctx.strokeRect(left, top, Math.max(0.5, right - left), base - top);
    }
    ctx.restore();
    if (model === 'phase' && !dc) {
          // 理论：正弦的反正弦分布（末段用细步长逼近奇点）
          const N2 = 400;
      const tx = new Float64Array(N2);
      const ty = new Float64Array(N2);
          for (let i = 0; i < N2; i++) {
            // 非线性映射使两端点更密
            const u = -0.9975 + (2 * 0.9975 * i) / (N2 - 1);
            const v = u * amp;
            tx[i] = v;
            ty[i] = 1 / (Math.PI * Math.sqrt(Math.max(1e-9, amp * amp - v * v)));
          }
          drawSeries(ctx, tx, ty, ax.xs, ax.ys, { color: ACCENT, width: 1.2, dash: [4, 3] });
        }
  };

  return (
    <Workbench
      controls={
        <>
          <ControlHead chapter="模块 02 / CH.2" name="随机过程与随机序列" />
          <FieldGroup title="过程模型">
            <Segmented
              options={[
                { value: 'phase', label: '随机相位正弦' },
                { value: 'ar1', label: 'AR(1) 高斯-马尔可夫' },
              ]}
              columns={2}
              value={model}
              onChange={(v) => setModel(v as Model)}
            />
          </FieldGroup>
          <FieldGroup title="过程参数">
            <Slider label="幅度" symbol="A" value={amp} min={0.2} max={2.5} step={0.05} onChange={setAmp} />
            {model === 'phase' ? (
              <Slider label="载频" symbol="f₀" value={f0} min={5} max={120} step={1} digits={0} unit="Hz" onChange={setF0} />
            ) : (
              <Slider label="相关系数" symbol="ρ" value={rho} min={0.3} max={0.99} step={0.01} onChange={setRho} />
            )}
            <Slider label="加性噪声 σ" symbol="σ_N" value={noise} min={0} max={1.2} step={0.01} onChange={setNoise} />
          </FieldGroup>
          <FieldGroup title="集合与采样">
            <Slider label="轨道数" symbol="M" value={M} min={4} max={80} step={1} digits={0} onChange={setM} />
            <Slider label="每轨点数" symbol="N" value={N} min={256} max={8192} step={256} digits={0} onChange={setN} />
            <Slider
              label="切片时刻"
              symbol="t₀"
              value={t0}
              min={0}
              max={Math.max(0.05, duration - 0.01)}
              step={0.005}
              unit="s"
              onChange={setT0}
            />
            <Slider
              label="高亮轨道"
              value={highlight + 1}
              min={1}
              max={M}
              step={1}
              digits={0}
              onChange={(v) => setHighlight(Math.min(M - 1, Math.round(v) - 1))}
            />
          </FieldGroup>
          <FieldGroup title="遍历性实验">
            <Toggle
              label="叠加随机直流分量"
              hint="B ~ N(0, A²)，使过程平稳但非均值遍历"
              checked={dc}
              onChange={setDc}
            />
          </FieldGroup>
          <FieldGroup title="谱估计方法">
            <Segmented
              options={[
                { value: 'biased', label: '有偏 ACF' },
                { value: 'unbiased', label: '无偏 ACF' },
                { value: 'welch', label: 'Welch PSD' },
              ]}
              columns={3}
              value={est}
              onChange={(v) => setEst(v as Estimator)}
            />
            <div className="flex gap-1 px-3 pb-2 pt-1">
              <Button variant="primary" className="flex-1" onClick={() => setSeed((s) => s + 104729)}>
                重新生成集合
              </Button>
            </div>
            <div className="px-3 pb-2">
              <span className="num text-[9px] text-slate-400">SEED = {seed} · T = {duration.toFixed(3)} s</span>
            </div>
          </FieldGroup>
        </>
      }
      center={
        <>
          <Figure
            code="A"
            title="样本函数集合与集合切片"
            meta={`t₀ = ${t0.toFixed(3)} s`}
            height={264}
            draw={drawTraces}
            deps={[sim, M, N, t0, stats, highlight, duration]}
                        legend={[
                          { label: '样本轨道', color: '#cbd5e1' },
                          { label: `轨道 #${highlight + 1}`, color: ACCENT },
                          { label: 't₀ 集合切片', color: WARN, dash: true },
                          { label: '集合均值', color: INK, dash: true },
                        ]}
                        note={
              <>
                橙色竖线为固定时刻 <Tex>{String.raw`t_0`}</Tex> 的集合切片；黑色虚线为该切片的集合均值。
                拖动 <span className="num">t₀</span> 观察集合均值是否随时间变化——平稳过程的集合均值应为常数。
              </>
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Figure
              code="B"
              title="集合切片的经验一阶密度"
              meta={`M=${M}`}
              height={210}
              draw={drawHistSlice}
              deps={[stats, M, model, amp, noise, dc]}
                            legend={[
                              { label: '集合直方图', color: '#93c5fd', fill: true },
                              ...(model === 'phase' && !dc ? [{ label: '反正弦密度', color: ACCENT, dash: true }] : []),
                            ]}
                          />
            <Figure
              code="C"
              title="集合切片抖动图"
              meta={`t₀=${t0.toFixed(2)}s`}
              height={210}
              draw={drawSlice}
              deps={[stats, M, t0, highlight]}
                            legend={[
                              { label: '集合均值', color: INK, dash: true },
                              { label: '时间均值', color: ACCENT, dash: true },
                            ]}
                          />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Figure
              code="D"
              title="样本自相关函数"
              meta={est === 'welch' ? 'Welch 不影响 ACF' : est === 'unbiased' ? '无偏估计' : '有偏估计'}
              height={226}
              draw={drawAcf}
              deps={[acf, acfTheory, est, maxLag]}
                            legend={[
                              { label: '经验 R̂_X(τ)', color: TRACE },
                              { label: '理论 R_X(τ)', color: ACCENT, dash: true },
                            ]}
                          />
            <Figure
              code="E"
              title="功率谱密度（维纳-辛钦）"
              meta={est === 'welch' ? 'Welch 8 段' : '周期图'}
              height={226}
              draw={drawPsd}
              deps={[psd, psdTheory, est, model, f0]}
                            legend={[
                              { label: '周期图 / Welch', color: TRACE },
                              { label: '理论 S_X(f)', color: ACCENT, dash: true },
                            ]}
                          />
          </div>
          <Panel code="F" title="遍历性数值比对" bodyClass="">
            <div className="grid grid-cols-1 divide-y divide-[#f1f5f9] md:grid-cols-2 md:divide-x md:divide-y-0">
              <div>
                <div className="border-b border-hairline bg-panel px-3 py-[3px]">
                  <span className="num text-[9px] uppercase tracking-wider text-slate-500">
                    集合平均（Ensemble）
                  </span>
                </div>
                <StatTable
                  compact
                  rows={[
                    { label: 't₀ 处均值', symbol: '⟨x(t₀)⟩', empirical: stats.em.mean, theoretical: theory.mean, digits: 4 },
                    { label: 't₀ 处方差', symbol: 'Var', empirical: stats.em.variance, theoretical: theory.variance, digits: 4 },
                    { label: '全样本均值', symbol: 'μ̂', empirical: stats.pooled.mean, theoretical: theory.mean, digits: 4 },
                  ]}
                />
              </div>
              <div>
                <div className="border-b border-hairline bg-panel px-3 py-[3px]">
                  <span className="num text-[9px] uppercase tracking-wider text-slate-500">
                    时间平均（Time Average）
                  </span>
                </div>
                <StatTable
                  compact
                  rows={[
                    { label: 'M 条轨道均值', symbol: 'x̄', empirical: stats.tm.mean, theoretical: theory.mean, digits: 4 },
                    { label: '轨道间散布', symbol: 'std(x̄)', empirical: stats.tm.std, theoretical: NaN, digits: 4 },
                    { label: 'R̂(0) 平均功率', symbol: 'R̂[0]', empirical: acf[0], theoretical: theory.r0, digits: 4 },
                  ]}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-[5px]">
              <Badge tone={isErgodic ? 'ok' : 'warn'}>
                {isErgodic ? '均值遍历：成立' : dc ? '均值遍历：不成立' : '均值遍历：待观察'}
              </Badge>
              <span className="num text-[9px] text-slate-400">
                |⟨x⟩ − x̄| = {fmt(ergMeanDiff, 5)} · 判定阈 ≈ {fmt(0.35 * Math.max(0.3, Math.sqrt(theory.variance / Math.sqrt(N))), 5)}
              </span>
              <span className="num ml-auto text-[9px] text-slate-400">
                T = {duration.toFixed(3)} s · BT = {((model === 'phase' ? f0 : 40) * duration).toFixed(1)}
              </span>
            </div>
          </Panel>
        </>
      }
      right={
        <>
          <FormulaCard
            items={
              model === 'phase'
                ? [
                    {
                      label: '过程定义',
                      tex: String.raw`X(t)=A\cos(\omega_0 t+\Theta)+N(t),\quad \Theta\sim U(0,2\pi)`,
                      note: `A=${amp.toFixed(2)}, f₀=${f0}Hz, σ_N=${noise.toFixed(2)}`,
                    },
                    {
                      label: '一、二阶矩',
                      tex: String.raw`E[X(t)]=0,\quad E[X^2(t)]=\frac{A^2}{2}+\sigma_N^2`,
                    },
                    {
                      label: '自相关（Θ 均匀 ⇒ 广义平稳）',
                      tex: String.raw`R_X(\tau)=\frac{A^2}{2}\cos(\omega_0\tau)+\sigma_N^2\delta(\tau)`,
                    },
                    {
                      label: '维纳-辛钦定理',
                      tex: String.raw`S_X(\omega)=\int_{-\infty}^{\infty}R_X(\tau)e^{-j\omega\tau}d\tau=\frac{\pi A^2}{2}\big[\delta(\omega-\omega_0)+\delta(\omega+\omega_0)\big]+\sigma_N^2`,
                    },
                  ]
                : [
                    {
                      label: 'AR(1) 递推',
                      tex: String.raw`X[n]=\rho X[n-1]+\sqrt{1-\rho^2}\,W[n],\quad W\sim N(0,1)`,
                      note: `ρ=${rho.toFixed(2)}，相关时间 τ_c ≈ ${fmt(-1 / (FS * Math.log(Math.max(1e-6, rho))), 4)} s`,
                    },
                    {
                      label: '自相关与谱',
                      tex: String.raw`R_X[m]=\sigma_X^2\rho^{|m|},\quad S_X(\omega)=\frac{\sigma_X^2(1-\rho^2)}{1-2\rho\cos\omega+\rho^2}`,
                    },
                    {
                      label: '高斯-马尔可夫性',
                      tex: String.raw`E[X[n]\mid X[n-1],\dots]=E[X[n]\mid X[n-1]]=\rho X[n-1]`,
                    },
                  ]
            }
            footer={
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-[#f1f5f9] pt-1.5">
                <span className="num text-[9px] text-slate-400">
                  有偏: R̂[m] = 1/N Σ x[n]x[n+m]
                </span>
                <span className="num text-[9px] text-slate-400">无偏: ÷(N−|m|)</span>
              </div>
            }
          />
          <DiagnosisPanel
            items={diag}
            verdict={dc ? '非遍历（构造）' : isErgodic ? '遍历性成立' : '收敛不足'}
            verdictTone={dc ? 'warn' : isErgodic ? 'ok' : 'info'}
            state={{
              module: 'random-process/ergodicity',
              model,
              params: { A: amp, f0, sigmaN: noise, rho: model === 'ar1' ? rho : undefined },
              ensemble: { traces: M, samples: N, fs: FS, t0 },
              empirical: {
                ensembleMean: stats.em.mean,
                ensembleVariance: stats.em.variance,
                timeMean: stats.tm.mean,
                timeMeanSpread: stats.tm.std,
                acf0: acf[0],
              },
              theoretical: theory,
              estimator: est,
            }}
          />
          <Steps
            items={[
              {
                q: '为什么随机相位使过程平稳？',
                a: 'Θ 的均匀分布使自相关中对 t 的依赖项 E[cos(2ω₀t+2Θ)] 恒为 0，于是 R_X(t+τ,t) 只依赖 τ。若 Θ 固定，过程是确定相位正弦，一阶矩随时间振荡，属于非平稳。',
              },
              {
                q: '遍历性的充要条件是什么？',
                a: '均值遍历的充要条件为 (1/T)∫₀ᵀ(1−τ/T)(R_X(τ)−μ²)dτ → 0。直观上要求自相关随 τ 衰减得比 1/T 更快，即“有效记忆长度远小于观测时长”。',
              },
              {
                q: '叠加随机直流为什么破坏遍历性？',
                a: '直流分量 B 对所有 t 恒定，属于不随时间衰减的“无限长记忆”。集合平均通过跨轨道抵消 B，而时间平均只能看到本轨道那一个 B，永远无法消除。',
              },
              {
                q: '为什么周期图会有毛刺？',
                a: '周期图是 PSD 的渐近无偏但非一致估计：每个频点方差约为 PSD²，不随 N 增大而消失。Welch 通过分段平均把方差降低约 1/K，代价是频率分辨率变差。',
              },
            ]}
          />
        </>
      }
    />
  );
}