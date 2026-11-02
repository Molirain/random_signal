import React, { useMemo, useState } from 'react';
import { createRng, seedFrom } from '../lib/rng';
import {
  ecdf,
  fmt,
  histogram,
  moments,
  normalCdf,
  normalPdf,
  quantile,
  relError,
  robustRange,
} from '../lib/math';
import {
  ACCENT,
  INK,
  MUTED,
  TRACE,
  WARN,
  drawAxes,
  drawBars,
  drawHLine,
  drawSeries,
  drawVLine,
  niceStep,
  ticksFor,
} from '../lib/plot';
import {
  Badge,
  Button,
  FieldGroup,
  Figure,
  NumberField,
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

type Dist = 'gauss' | 'uniform' | 'exp';
type Tab = 'dist' | 'clt' | 'nonlin';
type MapKind = 'half' | 'square' | 'abs';
type CltBase = 'uniform' | 'exp' | 'bimodal';

const DIST_LABEL: Record<Dist, string> = { gauss: '高斯', uniform: '均匀', exp: '指数' };

/* --------------------------------------------------------------- 生成 */

function generate(dist: Dist, mu: number, sigma: number, a: number, b: number, lam: number, n: number, seed: number) {
  const rng = createRng(seed);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (dist === 'gauss') out[i] = rng.normal(mu, sigma);
    else if (dist === 'uniform') out[i] = a + (b - a) * rng.uniform();
    else out[i] = rng.exponential(lam);
  }
  return out;
}

function theoryPdf(dist: Dist, x: number, mu: number, sigma: number, a: number, b: number, lam: number) {
  if (dist === 'gauss') return normalPdf(x, mu, sigma);
  if (dist === 'uniform') return x >= a && x <= b ? 1 / (b - a) : 0;
  return x >= 0 ? lam * Math.exp(-lam * x) : 0;
}

function theoryCdf(dist: Dist, x: number, mu: number, sigma: number, a: number, b: number, lam: number) {
  if (dist === 'gauss') return normalCdf(x, mu, sigma);
  if (dist === 'uniform') return Math.min(1, Math.max(0, (x - a) / (b - a)));
  return x <= 0 ? 0 : 1 - Math.exp(-lam * x);
}

function computeTheory(dist: Dist, mu: number, sigma: number, a: number, b: number, lam: number) {
  if (dist === 'gauss') return { mean: mu, variance: sigma * sigma, skew: 0, kurt: 3 };
  if (dist === 'uniform') {
    const w = b - a;
    return { mean: (a + b) / 2, variance: (w * w) / 12, skew: 0, kurt: 1.8 };
  }
  return { mean: 1 / lam, variance: 1 / (lam * lam), skew: 2, kurt: 9 };
}

/* --------------------------------------------------------------- 主组件 */

export default function Module1() {
  const [tab, setTab] = useState<Tab>('dist');
  const [dist, setDist] = useState<Dist>('gauss');
  const [mu, setMu] = useState(0);
  const [sigma, setSigma] = useState(1);
  const [a, setA] = useState(-1);
  const [b, setB] = useState(1);
  const [lam, setLam] = useState(1);
  const [n, setN] = useState(4000);
  const [bins, setBins] = useState(48);
  const [showEcdf, setShowEcdf] = useState(true);
  const [seed, setSeed] = useState(12345);

  // CLT
  const [cltBase, setCltBase] = useState<CltBase>('uniform');
  const [K, setK] = useState(4);
  const [cltN, setCltN] = useState(12000);

  // 非线性
  const [map, setMap] = useState<MapKind>('half');
  const [mapSigma, setMapSigma] = useState(1);

  /* ---------------- 分布实验 ---------------- */
  const data = useMemo(
    () => generate(dist, mu, sigma, a, b, lam, n, seed),
    [dist, mu, sigma, a, b, lam, n, seed],
  );
  const stats = useMemo(() => moments(data), [data]);
  const theory = useMemo(() => computeTheory(dist, mu, sigma, a, b, lam), [dist, mu, sigma, a, b, lam]);
  const lo = dist === 'gauss' ? mu - 5 * sigma : dist === 'uniform' ? a - 0.08 * (b - a) : 0;
  const hi = dist === 'gauss' ? mu + 5 * sigma : dist === 'uniform' ? b + 0.08 * (b - a) : (5.5 / lam);
  const hist = useMemo(() => histogram(data, bins, lo, hi), [data, bins, lo, hi]);
  const empCdf = useMemo(() => ecdf(data, 260), [data]);

  /* ---------------- CLT ---------------- */
  const clt = useMemo(() => {
    const rng = createRng(seedFrom(seed, K, cltN, cltBase));
    const y = new Float64Array(cltN);
    // 基分布统一到 (μ, σ) 便于标准化
    let mean = 0.5;
    let sd = 1 / Math.sqrt(12);
    if (cltBase === 'exp') {
      mean = 1;
      sd = 1;
    } else if (cltBase === 'bimodal') {
      mean = 0;
      sd = 1;
    }
    if (cltBase === 'exp') {
      for (let i = 0; i < cltN; i++) {
        let s = 0;
        for (let k = 0; k < K; k++) s += rng.exponential(1);
        y[i] = (s - K * mean) / (Math.sqrt(K) * sd);
      }
    } else if (cltBase === 'bimodal') {
      for (let i = 0; i < cltN; i++) {
        let s = 0;
        for (let k = 0; k < K; k++) s += rng.uniform() < 0.5 ? -1 : 1;
        y[i] = (s - K * mean) / (Math.sqrt(K) * sd);
      }
    } else {
      for (let i = 0; i < cltN; i++) {
        let s = 0;
        for (let k = 0; k < K; k++) s += rng.uniform();
        y[i] = (s - K * mean) / (Math.sqrt(K) * sd);
      }
    }
    const m = moments(y);
    const h = histogram(y, 60, -4.2, 4.2);
    const q = Array.from({ length: 200 }, (_, i) => quantile(y, (i + 0.5) / 200));
    return { y, m, h, q };
  }, [seed, K, cltN, cltBase]);

  /* ---------------- CLT 收敛曲线（多 K 重复） ---------------- */
    const cltCurve = useMemo(() => {
      const kMax = Math.max(12, Math.min(64, K + 6));
      const sample = 3200;
      const rng = createRng(seedFrom(seed, 31, cltBase));
      const drawBase = () => {
        if (cltBase === 'exp') return rng.exponential(1);
        if (cltBase === 'bimodal') return rng.uniform() < 0.5 ? -1 : 1;
        return rng.uniform();
      };
      const mean = cltBase === 'exp' ? 1 : cltBase === 'bimodal' ? 0 : 0.5;
      const sd = cltBase === 'exp' ? 1 : cltBase === 'bimodal' ? 1 : 1 / Math.sqrt(12);
      const ks = new Float64Array(kMax);
      const skew = new Float64Array(kMax);
      const exkurt = new Float64Array(kMax);
      const buf = new Float64Array(sample);
      for (let k = 1; k <= kMax; k++) {
        for (let i = 0; i < sample; i++) {
          let s = 0;
          for (let j = 0; j < k; j++) s += drawBase();
          buf[i] = (s - k * mean) / (Math.sqrt(k) * sd);
        }
        const mm = moments(buf);
        ks[k - 1] = k;
        skew[k - 1] = Math.abs(mm.skewness);
        exkurt[k - 1] = Math.abs(mm.kurtosis - 3);
      }
      // 原始基分布的偏度/超额峰度，用于给出 1/√K、1/K 参考斜率
      const base = new Float64Array(sample);
      for (let i = 0; i < sample; i++) base[i] = drawBase();
      const bm = moments(base);
      const baseSkew = Math.abs(bm.skewness);
      const baseExKurt = Math.abs(bm.kurtosis - 3);
      return { kMax, ks, skew, exkurt, baseSkew: baseSkew || 0.2, baseExKurt: baseExKurt || 0.2 };
    }, [seed, cltBase, K]);

    /* ---------------- CLT 有限 K 的理论矩 ---------------- */
  // 对 K 个 iid 标准化变量：偏度 = γ1/√K，超额峰度 = (γ2−3)/K（Edgeworth 首项）
  const cltTheory = useMemo(() => {
    const base =
      cltBase === 'uniform'
        ? { skew: 0, kurt: 1.8 }
        : cltBase === 'exp'
          ? { skew: 2, kurt: 9 }
          : { skew: 0, kurt: 1 };
    return {
      skew: base.skew / Math.sqrt(K),
      kurt: 3 + (base.kurt - 3) / K,
      base,
    };
  }, [cltBase, K]);

  /* ---------------- 非线性 ---------------- */
    const nonlin = useMemo(() => {
      const rng = createRng(seedFrom(seed, mapSigma, 7));
      const x = new Float64Array(20000);
      for (let i = 0; i < x.length; i++) x[i] = rng.normal(0, mapSigma);
      const y = new Float64Array(x.length);
      for (let i = 0; i < x.length; i++) {
        y[i] = map === 'half' ? Math.max(0, x[i]) : map === 'square' ? x[i] * x[i] : Math.abs(x[i]);
      }
      const m = moments(y);
      const s = mapSigma;
      let thy: { mean: number; variance: number };
      if (map === 'half') thy = { mean: s / Math.sqrt(2 * Math.PI), variance: s * s * (0.5 - 1 / (2 * Math.PI)) };
      else if (map === 'square') thy = { mean: s * s, variance: 2 * s ** 4 };
      else thy = { mean: s * Math.sqrt(2 / Math.PI), variance: s * s * (1 - 2 / Math.PI) };
      const hi = map === 'square' ? 6 * s * s : 3.6 * s;
      const bins = 56;
      return { x, y, m, thy, h: histogram(y, bins, 0, hi) };
    }, [map, mapSigma, seed]);

  /* ---------------- 诊断 ---------------- */
    const diag: DiagItem[] = useMemo(() => {
      const items: DiagItem[] = [];
      const meanErr = Math.abs(relError(stats.mean, theory.mean));
      const meanDev = Math.abs(stats.mean - theory.mean);
      const se = Math.sqrt(theory.variance / n);
      const varErr = Math.abs(relError(stats.variance, theory.variance));
      if (Math.abs(theory.mean) < 1e-12) {
        items.push({
          tone: meanDev < 3 * se ? 'ok' : 'warn',
          title: '一阶矩收敛（零均值判定）',
          body: `理论均值恰为 0，相对误差无定义。经验均值 ${fmt(stats.mean, 4)}，抽样标准误 σ/√M = ${fmt(se, 4)}，偏差 ${fmt(meanDev / Math.max(se, 1e-12), 2)}σ${meanDev < 3 * se ? '，处于正常波动范围。' : '，超出 3σ，请检查生成器参数。'}`,
        });
      } else if (meanErr > 5) {
        items.push({
          tone: 'warn',
          title: '样本均值偏移超过 5%',
          body: `经验均值 ${fmt(stats.mean, 4)} 与理论 ${fmt(theory.mean, 4)} 相差 ${meanErr.toFixed(2)}%。检查参数是否与生成器一致，或提高样本数 M 以降低标准误 σ/√M。`,
        });
      } else {
        items.push({
          tone: 'ok',
          title: '一阶矩收敛',
          body: `均值相对误差 ${meanErr.toFixed(2)}%，落在抽样波动的 1σ 区间内（理论标准误 ${fmt(se, 4)}）。`,
        });
      }
    if (varErr > 8) {
      items.push({
        tone: 'warn',
        title: '二阶矩偏差偏大',
        body: `方差误差 ${varErr.toFixed(2)}%。重尾分布（指数）的四阶矩有限但收敛慢，方差估计的方差约为 2σ⁴/M，需要更大 M。`,
      });
    } else {
      items.push({
        tone: 'info',
        title: '二阶矩校验',
        body: `经验方差 ${fmt(stats.variance, 4)}，理论 ${fmt(theory.variance, 4)}，相对误差 ${varErr.toFixed(2)}%。`,
      });
    }
    items.push({
      tone: 'info',
      title: `直方图 ${bins} 箱的偏差-方差权衡`,
      body:
        bins < 20
          ? '箱数偏少：直方图过度平滑，系统性展宽理论峰，属于偏差主导。'
          : bins > 90
            ? '箱数偏多：每箱样本不足 50 个，出现锯齿状抖动，属于方差主导。'
            : '每个箱约有 ' + Math.round(n / bins) + ' 个样本，处于偏差与方差的平衡区间。',
    });
    if (dist === 'exp') {
      items.push({
        tone: 'warn',
        title: '指数分布右尾截断',
        body: `当前横轴截断于 ${fmt(hi, 2)}，超出部分概率质量 ${(Math.exp(-lam * hi) * 100).toFixed(2)}%，因此直方图面积略小于 1。`,
      });
    }
    return items;
  }, [stats, theory, n, bins, dist, lam, hi]);

  const cltDiag: DiagItem[] = useMemo(() => {
      const excess = clt.m.kurtosis - cltTheory.kurt;
      const skewDev = Math.abs(clt.m.skewness - cltTheory.skew);
      const items: DiagItem[] = [
        {
          tone: skewDev < 0.06 && Math.abs(excess) < 0.12 ? 'ok' : 'warn',
          title: '高阶矩与 Edgeworth 预测对照',
          body: `偏度经验 ${fmt(clt.m.skewness, 3)} / 理论 γ₁/√K = ${fmt(cltTheory.skew, 3)}；峰度经验 ${fmt(clt.m.kurtosis, 3)} / 理论 3+(γ₂−3)/K = ${fmt(cltTheory.kurt, 3)}。注意 K 有限时峰度并不等于 3，需用 1/K 修正项而非直接用正态值判定。`,
        },
        {
          tone: K >= 8 ? 'ok' : 'info',
          title: `K = ${K} 的近似有效区间`,
          body:
            K >= 8
              ? 'K ≥ 8 时经验分布与 N(0,1) 的偏差已小于典型教材图示分辨率，可视为近似高斯。'
              : 'K 较小时仍可辨认原始分布的形态（如双峰的凹陷或指数的右偏），这正是 CLT 收敛速率的直观体现。',
        },
        {
          tone: 'info',
          title: '归一化因子的作用',
          body: '除以 √K 而非 K，使和的方差保持为单位值；若除以 K，分布会随 K 收缩为 δ 函数。',
        },
      ];
    if (cltBase === 'bimodal') {
      items.push({
        tone: 'warn',
        title: '双峰分布收敛最慢',
        body: '双峰分布在原点附近概率密度极低，K 较小时 PDF 中心出现明显凹陷；该凹陷随 K 增大按 O(1/K) 填补。',
      });
    }
    return items;
      }, [clt, cltTheory, K, cltBase]);

  const nonlinDiag: DiagItem[] = useMemo(() => {
    const errMean = Math.abs(relError(nonlin.m.mean, nonlin.thy.mean));
    const errVar = Math.abs(relError(nonlin.m.variance, nonlin.thy.variance));
    const items: DiagItem[] = [
      {
        tone: errMean < 3 ? 'ok' : 'warn',
        title: '输出一阶矩',
        body: `经验 ${fmt(nonlin.m.mean, 4)} / 理论 ${fmt(nonlin.thy.mean, 4)}，误差 ${errMean.toFixed(2)}%。`,
      },
      {
        tone: errVar < 4 ? 'ok' : 'warn',
        title: '输出二阶矩',
        body: `经验 ${fmt(nonlin.m.variance, 4)} / 理论 ${fmt(nonlin.thy.variance, 4)}，误差 ${errVar.toFixed(2)}%。`,
      },
    ];
    if (map === 'square') {
      items.push({
        tone: 'warn',
        title: '非线性破坏了高斯性',
        body: `输出偏度 ${fmt(nonlin.m.skewness, 3)}，峰度 ${fmt(nonlin.m.kurtosis, 3)}，远偏离 (0, 3)。平方律检波输出服从 χ²₁ 尺度族，只有“高斯输入 + 线性系统”才保持高斯性。`,
      });
    } else if (map === 'half') {
      items.push({
        tone: 'warn',
        title: '零点的概率原子',
        body: '半波整流把整个负半轴映射到 y = 0，输出在 0 处存在质量 0.5 的离散原子，严格意义上已不是连续型随机变量，PDF 需写成 f_Y(y)+P(X<0)δ(y)。',
      });
    } else {
      items.push({
        tone: 'info',
        title: '折叠式映射的双分支',
        body: 'f_Y(y) = f_X(y) + f_X(−y)（y>0），高斯输入下等于 2f_X(y)，因此 |X| 的均值大于零而方差小于 σ²。',
      });
    }
    return items;
  }, [nonlin, map]);

  /* ------------------------------------------------------------ 绘图 */
  const drawHistPdf = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 40, y: 18, w: w - 56, h: h - 56 };
      let yMax = 0;
      for (let i = 0; i < hist.density.length; i++) yMax = Math.max(yMax, hist.density[i]);
      for (let i = 0; i < 200; i++) {
        const x = lo + ((hi - lo) * i) / 199;
        yMax = Math.max(yMax, theoryPdf(dist, x, mu, sigma, a, b, lam));
      }
      yMax *= 1.12;
      const ax = drawAxes(ctx, rect, {
        xDomain: [lo, hi],
        yDomain: [0, yMax || 1],
        xLabel: '样本取值 x',
        yLabel: 'f_X(x)',
        title: '经验 PDF 与理论密度',
        titleSub: `M = ${n} · bins = ${bins}`,
      });
    drawBars(ctx, hist.centers, hist.density, hist.binWidth, ax.xs, ax.ys, {
      fill: '#dbeafe',
      stroke: '#bfdbfe',
    });
    const N = 400;
    const tx = new Float64Array(N);
    const ty = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = lo + ((hi - lo) * i) / (N - 1);
      tx[i] = x;
      ty[i] = theoryPdf(dist, x, mu, sigma, a, b, lam);
    }
    drawSeries(ctx, tx, ty, ax.xs, ax.ys, { color: INK, width: 1.5 });
        // 均值线
        drawVLine(ctx, theory.mean, ax.xs, ax.ys, { color: ACCENT, dash: [2, 3] });
      };

  const drawEcdfFig = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 40, y: 18, w: w - 56, h: h - 56 };
    const ax = drawAxes(ctx, rect, {
      xDomain: [lo, hi],
      yDomain: [0, 1],
      xLabel: '样本取值 x',
      yLabel: 'F_X(x)',
      title: '经验 CDF（ECDF）与理论 CDF',
      titleSub: 'K-S 距离可用作拟合检验',
    });
    // ECDF 阶梯
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax.xs.r0, ax.ys.r1, ax.xs.r1 - ax.xs.r0, ax.ys.r0 - ax.ys.r1);
    ctx.clip();
    ctx.strokeStyle = TRACE;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < empCdf.x.length; i++) {
      const px = ax.xs(empCdf.x[i]);
      const py = ax.ys(empCdf.y[i]);
      if (i === 0) ctx.moveTo(px, py);
      else {
        ctx.lineTo(px, ax.ys(empCdf.y[i - 1]));
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.restore();
    const P = 300;
    const tx = new Float64Array(P);
    const ty = new Float64Array(P);
    for (let i = 0; i < P; i++) {
      const x = lo + ((hi - lo) * i) / (P - 1);
      tx[i] = x;
      ty[i] = theoryCdf(dist, x, mu, sigma, a, b, lam);
    }
    drawSeries(ctx, tx, ty, ax.xs, ax.ys, { color: ACCENT, width: 1.3 });
    // 最大偏差
    let dmax = 0;
    for (let i = 0; i < empCdf.x.length; i++) {
      dmax = Math.max(dmax, Math.abs(empCdf.y[i] - theoryCdf(dist, empCdf.x[i], mu, sigma, a, b, lam)));
    }
    ctx.save();
    ctx.fillStyle = MUTED;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`D_KS ≈ ${dmax.toFixed(4)}`, rect.x + 6, rect.y + 12);
        ctx.restore();
      };

  const drawCltHist = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 40, y: 18, w: w - 56, h: h - 56 };
    const yMax = Math.max(...Array.from(clt.h.density)) * 1.1;
    const ax = drawAxes(ctx, rect, {
      xDomain: [-4.2, 4.2],
      yDomain: [0, yMax],
      xLabel: '标准化和 y',
      yLabel: 'f_Y(y)',
      title: `Y_K 的经验 PDF（K = ${K}）`,
      titleSub: `M = ${cltN}`,
    });
    drawBars(ctx, clt.h.centers, clt.h.density, clt.h.binWidth, ax.xs, ax.ys, {
      fill: '#dbeafe',
      stroke: '#bfdbfe',
    });
    const N = 300;
    const tx = new Float64Array(N);
    const ty = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = -4.2 + (8.4 * i) / (N - 1);
      tx[i] = x;
      ty[i] = normalPdf(x, 0, 1);
    }
    drawSeries(ctx, tx, ty, ax.xs, ax.ys, { color: ACCENT, width: 1.5 });
      };

  const drawQQ = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const rect = { x: 42, y: 18, w: Math.min(w - 58, 300), h: h - 56 };
    const r = 3.4;
    const ax = drawAxes(ctx, rect, {
      xDomain: [-r, r],
      yDomain: [-r, r],
      xLabel: '标准正态分位数',
      yLabel: 'Y_K 样本分位数',
      title: 'Q-Q 图',
      titleSub: '偏离 45° 即偏离高斯',
    });
    const N = 160;
    const qx = new Float64Array(N + 1);
    const qy = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) {
      const p = (i + 0.5) / N;
      // 正态分位数近似（Acklam 有理逼近）
      qx[i] = invNormal(p);
      qy[i] = clt.q[Math.min(clt.q.length - 1, Math.floor(p * clt.q.length))];
    }
    qx[N] = r;
    qy[N] = r;
    drawSeries(ctx, qx, qy, ax.xs, ax.ys, { color: '#cbd5e1', width: 1, dash: [4, 3] });
    drawSeries(ctx, qx.subarray(0, N), qy.subarray(0, N), ax.xs, ax.ys, { color: TRACE, width: 1.1 });
    ctx.save();
    ctx.fillStyle = ACCENT;
    for (let i = 0; i < N; i += 1) {
      ctx.beginPath();
      ctx.arc(ax.xs(qx[i]), ax.ys(qy[i]), 0.9, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  };

  const drawNonlin = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          const rect = { x: 40, y: 18, w: w - 56, h: h - 54 };
          // 半波整流时第 0 个箱含 0.5 的质量（离散原子），其密度值会压扁其余曲线，
          // 因此纵轴只按连续部分（第 1 箱起）与理论曲线定标，原子柱自然被裁剪。
          const s = mapSigma;
          const N = 400;
          const tx = new Float64Array(N);
          const ty = new Float64Array(N);
          for (let i = 0; i < N; i++) {
            const y = (nonlin.h.hi * i) / (N - 1);
            tx[i] = y;
            let v = 0;
            if (map === 'square') v = y > 1e-4 ? Math.exp(-y / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI * y)) : 0;
            else if (map === 'half') v = Math.exp(-(y * y) / (2 * s * s)) / (s * Math.sqrt(2 * Math.PI));
            else v = (2 * Math.exp(-(y * y) / (2 * s * s))) / (s * Math.sqrt(2 * Math.PI));
            ty[i] = v;
          }
          let yMax = 0;
          for (let i = 0; i < N; i++) yMax = Math.max(yMax, ty[i]);
          for (let i = 1; i < nonlin.h.density.length; i++) yMax = Math.max(yMax, nonlin.h.density[i]);
          yMax *= 1.14;
          const ax = drawAxes(ctx, rect, {
            xDomain: [0, nonlin.h.hi],
            yDomain: [0, yMax],
            xLabel: '输出取值 y',
            yLabel: 'f_Y(y)',
            title: '非线性变换后的输出 PDF',
            titleSub: map === 'half' ? '半波整流' : map === 'square' ? '平方律检波' : '全波整流',
          });
          drawBars(ctx, nonlin.h.centers, nonlin.h.density, nonlin.h.binWidth, ax.xs, ax.ys, {
            fill: '#dbeafe',
            stroke: '#bfdbfe',
          });
          drawSeries(ctx, tx, ty, ax.xs, ax.ys, { color: ACCENT, width: 1.5 });
          if (map === 'half') {
            // 零点冲激：密度意义上的质量 0.5，超出连续部分坐标范围
            const px = Math.round(ax.xs(nonlin.h.binWidth / 2)) + 0.5;
            ctx.save();
            ctx.strokeStyle = WARN;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(px, ax.ys(0));
            ctx.lineTo(px, ax.ys(yMax * 0.82));
      ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px - 3, ax.ys(yMax * 0.82) + 4);
            ctx.lineTo(px, ax.ys(yMax * 0.82));
            ctx.lineTo(px + 3, ax.ys(yMax * 0.82) + 4);
            ctx.stroke();
            ctx.font = '8.5px "JetBrains Mono", monospace';
            ctx.fillStyle = WARN;
            ctx.textAlign = 'left';
            ctx.fillText('P(X<0) = 0.5 原子（超出纵轴）', px + 5, ax.ys(yMax * 0.82) - 6);
            ctx.restore();
          }
        };

  const drawMapping = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const xr = 3.4 * mapSigma;
    const yr = map === 'square' ? xr * xr : xr;
    const rect = { x: 40, y: 18, w: w - 56, h: h - 56 };
    const ax = drawAxes(ctx, rect, {
      xDomain: [-xr, xr],
      yDomain: [map === 'half' ? -0.15 * yr : 0, yr],
      xLabel: '输入 x',
      yLabel: '输出 y = g(x)',
      title: '映射函数与样本散布',
      titleSub: '同一 x 的分支数决定 PDF 叠加项数',
    });
    // 样本散点（抽稀）
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = ACCENT;
    for (let i = 0; i < nonlin.x.length; i += 7) {
      const px = ax.xs(nonlin.x[i]);
      const py = ax.ys(nonlin.y[i]);
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.restore();
    const N = 200;
    const gx = new Float64Array(N);
    const gy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = -xr + (2 * xr * i) / (N - 1);
      gx[i] = x;
      gy[i] = map === 'half' ? Math.max(0, x) : map === 'square' ? x * x : Math.abs(x);
    }
    drawSeries(ctx, gx, gy, ax.xs, ax.ys, { color: INK, width: 1.5 });
    drawHLine(ctx, nonlin.m.mean, ax.xs, ax.ys, { color: WARN, dash: [3, 3] });
    ctx.save();
    ctx.font = '8.5px "JetBrains Mono", monospace';
    ctx.fillStyle = WARN;
    ctx.textAlign = 'right';
    ctx.fillText(`E[Y] = ${fmt(nonlin.m.mean, 3)}`, ax.xs.r1 - 4, ax.ys(nonlin.m.mean) - 4);
    ctx.restore();
  };

  const drawSkewKurt = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const rect = { x: 54, y: 16, w: w - 70, h: h - 50 };
      const kMax = cltCurve.kMax;
      const yMax = Math.max(0.35, cltCurve.skew[0], cltCurve.exkurt[0], cltCurve.baseSkew * 1.1) * 1.15;
      const ax = drawAxes(ctx, rect, {
        xDomain: [1, kMax],
        yDomain: [0, yMax],
        xLabel: '叠加个数 K',
              yLabel: '偏差',
        title: 'CLT 收敛速率（多 K 重复抽样）',
        titleSub: `每次 M = 3200`,
        xTickCount: 6,
      });
      // 参考斜率：偏度 ∝ K^{-1/2}，超额峰度 ∝ K^{-1}
      const N = 120;
      const kr = new Float64Array(N);
      const refS = new Float64Array(N);
      const refK = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        const k = 1 + ((kMax - 1) * i) / (N - 1);
        kr[i] = k;
        refS[i] = (cltCurve.baseSkew / Math.sqrt(k)) * 0.55;
        refK[i] = (cltCurve.baseExKurt / k) * 0.55;
      }
      drawSeries(ctx, kr, refS, ax.xs, ax.ys, { color: '#cbd5e1', width: 1, dash: [4, 3] });
      drawSeries(ctx, kr, refK, ax.xs, ax.ys, { color: '#d6dde6', width: 1, dash: [1, 3] });
      drawSeries(ctx, cltCurve.ks, cltCurve.skew, ax.xs, ax.ys, { color: ACCENT, width: 1.4 });
      drawSeries(ctx, cltCurve.ks, cltCurve.exkurt, ax.xs, ax.ys, { color: WARN, width: 1.4 });
      // 当前 K 标记
      drawVLine(ctx, K, ax.xs, ax.ys, { color: INK, dash: [2, 3], label: `K=${K}` });
          };

  /* ------------------------------------------------------------ 渲染 */
  const statRows =
    tab === 'nonlin'
      ? [
          { label: '均值', symbol: 'E[Y]', empirical: nonlin.m.mean, theoretical: nonlin.thy.mean },
          { label: '方差', symbol: 'Var[Y]', empirical: nonlin.m.variance, theoretical: nonlin.thy.variance },
          { label: '标准差', symbol: 'σ_Y', empirical: nonlin.m.std, theoretical: Math.sqrt(nonlin.thy.variance) },
        ]
      : [
          { label: '均值', symbol: 'μ', empirical: stats.mean, theoretical: theory.mean },
          { label: '方差', symbol: 'σ²', empirical: stats.variance, theoretical: theory.variance },
          { label: '标准差', symbol: 'σ', empirical: stats.std, theoretical: Math.sqrt(theory.variance) },
          { label: '偏度', symbol: 'γ₁', empirical: stats.skewness, theoretical: theory.skew },
          { label: '峰度', symbol: 'γ₂', empirical: stats.kurtosis, theoretical: theory.kurt },
        ];

  const formulaItems =
    tab === 'clt'
      ? [
          {
            label: '标准化叠加',
            tex: String.raw`Y_K=\frac{1}{\sqrt{K}}\sum_{i=1}^{K}\frac{X_i-\mu}{\sigma}`,
            note: `当前 K = ${K}，Var[Y_K] = 1（与 K 无关）。`,
          },
          {
            label: 'Lindeberg–Lévy 中心极限定理',
            tex: String.raw`\lim_{K\to\infty} F_{Y_K}(y)=\Phi(y)=\frac{1}{\sqrt{2\pi}}\int_{-\infty}^{y}e^{-t^2/2}\,dt`,
          },
          {
            label: 'Edgeworth 一阶修正',
            tex: String.raw`f_{Y_K}(y)\approx\varphi(y)\left[1+\frac{\gamma_1}{6\sqrt{K}}H_3(y)\right]`,
            note: '故偏度以 1/√K 速率消失，这正是 K 较小时仍能看出原始分布偏斜的原因。',
          },
        ]
      : tab === 'nonlin'
        ? [
            {
              label: '单调映射的密度变换',
              tex: String.raw`f_Y(y)=f_X\big(g^{-1}(y)\big)\left|\frac{d}{dy}g^{-1}(y)\right|`,
            },
            {
              label: '当前映射',
              tex:
                map === 'half'
                  ? String.raw`Y=\max(0,X),\quad f_Y(y)=f_X(y)u(y)+P(X<0)\,\delta(y)`
                  : map === 'square'
                    ? String.raw`Y=X^2,\quad f_Y(y)=\frac{f_X(\sqrt{y})+f_X(-\sqrt{y})}{2\sqrt{y}}\,u(y)`
                    : String.raw`Y=|X|,\quad f_Y(y)=f_X(y)+f_X(-y),\ y>0`,
            },
            {
              label: '高斯输入下的理论矩',
              tex:
                map === 'half'
                  ? String.raw`E[Y]=\frac{\sigma}{\sqrt{2\pi}},\quad \mathrm{Var}[Y]=\sigma^2\left(\frac12-\frac{1}{2\pi}\right)`
                  : map === 'square'
                    ? String.raw`E[Y]=\sigma^2,\quad \mathrm{Var}[Y]=2\sigma^4,\quad \gamma_1=\sqrt8`
                    : String.raw`E[Y]=\sigma\sqrt{\frac{2}{\pi}},\quad \mathrm{Var}[Y]=\sigma^2\left(1-\frac{2}{\pi}\right)`,
              note: `σ = ${mapSigma.toFixed(2)}`,
            },
          ]
        : dist === 'gauss'
          ? [
              {
                label: '高斯（正态）分布',
                tex: String.raw`f_X(x)=\frac{1}{\sqrt{2\pi}\sigma}\exp\left[-\frac{(x-\mu)^2}{2\sigma^2}\right]`,
                note: `μ = ${mu.toFixed(2)}, σ² = ${(sigma * sigma).toFixed(3)}`,
              },
              {
                label: '生成方法：Box–Muller',
                tex: String.raw`Z=\sqrt{-2\ln U_1}\cos(2\pi U_2),\quad U_1,U_2\sim U(0,1)`,
              },
              {
                label: '矩',
                tex: String.raw`E[X]=\mu,\quad \mathrm{Var}[X]=\sigma^2,\quad \gamma_1=0,\quad \gamma_2=3`,
              },
            ]
          : dist === 'uniform'
            ? [
                {
                  label: '均匀分布',
                  tex: String.raw`f_X(x)=\frac{1}{b-a},\quad a\le x\le b`,
                  note: `a = ${a.toFixed(2)}, b = ${b.toFixed(2)}`,
                },
                {
                  label: '矩',
                  tex: String.raw`E[X]=\frac{a+b}{2},\quad \mathrm{Var}[X]=\frac{(b-a)^2}{12},\quad \gamma_2=\frac95`,
                },
                {
                  label: '生成方法：直接抽样',
                  tex: String.raw`X=a+(b-a)U,\quad U\sim U(0,1)`,
                },
              ]
            : [
                {
                  label: '指数分布',
                  tex: String.raw`f_X(x)=\lambda e^{-\lambda x}u(x),\quad F_X(x)=\left(1-e^{-\lambda x}\right)u(x)`,
                  note: `λ = ${lam.toFixed(2)}，均值 ${(1 / lam).toFixed(3)}`,
                },
                {
                  label: '生成方法：逆变换',
                  tex: String.raw`X=-\frac{1}{\lambda}\ln(1-U),\quad U\sim U(0,1)`,
                },
                {
                  label: '矩',
                  tex: String.raw`E[X]=\frac1\lambda,\quad \mathrm{Var}[X]=\frac1{\lambda^2},\quad \gamma_1=2,\quad \gamma_2=9`,
                },
              ];

  return (
    <Workbench
      controls={
        <>
          <ControlHead chapter="模块 01 / CH.1" name="随机信号基础" />
          <FieldGroup title="实验子项">
            <Segmented
              options={[
                { value: 'dist', label: '分布发生器' },
                { value: 'clt', label: '中心极限定理' },
                { value: 'nonlin', label: '非线性变换' },
              ]}
              value={tab}
              onChange={(v) => setTab(v as Tab)}
            />
          </FieldGroup>

          {tab === 'dist' && (
            <>
              <FieldGroup title="分布类型">
                <Segmented
                  options={[
                    { value: 'gauss', label: '高斯 N(μ,σ²)' },
                    { value: 'uniform', label: '均匀 U(a,b)' },
                    { value: 'exp', label: '指数 Exp(λ)' },
                  ]}
                  columns={3}
                  value={dist}
                  onChange={(v) => setDist(v as Dist)}
                />
              </FieldGroup>
              <FieldGroup title="参数" note="闭式解直接驱动理论曲线">
                {dist === 'gauss' && (
                  <>
                    <Slider label="均值" symbol="μ" value={mu} min={-4} max={4} step={0.1} onChange={setMu} />
                    <Slider
                      label="标准差"
                      symbol="σ"
                      value={sigma}
                      min={0.2}
                      max={3}
                      step={0.05}
                      onChange={setSigma}
                    />
                  </>
                )}
                {dist === 'uniform' && (
                  <>
                    <Slider label="下界" symbol="a" value={a} min={-4} max={0} step={0.1} onChange={setA} />
                    <Slider label="上界" symbol="b" value={b} min={0.2} max={4} step={0.1} onChange={setB} />
                  </>
                )}
                {dist === 'exp' && (
                  <Slider label="速率参数" symbol="λ" value={lam} min={0.2} max={3} step={0.05} onChange={setLam} />
                )}
              </FieldGroup>
              <FieldGroup title="蒙特卡洛规模">
                <Slider
                  label="样本数"
                  symbol="M"
                  value={n}
                  min={200}
                  max={40000}
                  step={200}
                  digits={0}
                  onChange={setN}
                />
                <Slider label="直方图箱数" value={bins} min={10} max={120} step={2} digits={0} onChange={setBins} />
                <Toggle label="显示 ECDF 对照" checked={showEcdf} onChange={setShowEcdf} />
                <div className="flex gap-1 px-3 pb-2 pt-1">
                  <Button variant="primary" onClick={() => setSeed((s) => s + 7919)} className="flex-1">
                    重新抽样
                  </Button>
                  <Button onClick={() => setSeed(12345)}>重置种子</Button>
                </div>
                <div className="px-3 pb-2">
                  <span className="num text-[9px] text-slate-400">LFSR_SEED = {seed}</span>
                </div>
              </FieldGroup>
            </>
          )}

          {tab === 'clt' && (
            <>
              <FieldGroup title="基分布 X_i">
                <Segmented
                  options={[
                    { value: 'uniform', label: '均匀' },
                    { value: 'exp', label: '指数' },
                    { value: 'bimodal', label: '双峰 ±1' },
                  ]}
                  columns={3}
                  value={cltBase}
                  onChange={(v) => setCltBase(v as CltBase)}
                />
              </FieldGroup>
              <FieldGroup title="叠加控制">
                <Slider label="叠加个数" symbol="K" value={K} min={1} max={50} step={1} digits={0} onChange={setK} />
                <Slider
                  label="样本数"
                  symbol="M"
                  value={cltN}
                  min={1000}
                  max={60000}
                  step={1000}
                  digits={0}
                  onChange={setCltN}
                />
                <NumberField label="K 精确输入" value={K} min={1} max={200} onChange={(v) => setK(Math.round(v))} />
                <div className="flex gap-1 px-3 pb-2 pt-1">
                  <Button variant="primary" onClick={() => setSeed((s) => s + 7919)} className="flex-1">
                    重新抽样
                  </Button>
                </div>
              </FieldGroup>
              <FieldGroup title="快速预设">
                <div className="grid grid-cols-4 gap-1 px-3 pb-2">
                  {[1, 2, 4, 12].map((k) => (
                    <Button key={k} onClick={() => setK(k)} variant={K === k ? 'primary' : 'default'}>
                      K={k}
                    </Button>
                  ))}
                </div>
              </FieldGroup>
            </>
          )}

          {tab === 'nonlin' && (
            <>
              <FieldGroup title="映射函数 g(·)">
                <Segmented
                  options={[
                    { value: 'half', label: '半波整流' },
                    { value: 'square', label: '平方律' },
                    { value: 'abs', label: '全波整流' },
                  ]}
                  columns={3}
                  value={map}
                  onChange={(v) => setMap(v as MapKind)}
                />
              </FieldGroup>
              <FieldGroup title="输入参数">
                <Slider
                  label="输入标准差"
                  symbol="σ"
                  value={mapSigma}
                  min={0.3}
                  max={2.5}
                  step={0.05}
                  onChange={setMapSigma}
                />
                <div className="px-3 pb-2 pt-1">
                  <Button variant="primary" className="w-full" onClick={() => setSeed((s) => s + 7919)}>
                    重新抽样
                  </Button>
                </div>
              </FieldGroup>
              <FieldGroup title="理论提示">
                <div className="px-3 py-2 text-[10px] leading-[1.55] text-slate-500">
                  高斯输入经<strong className="font-semibold text-ink">线性</strong>系统仍为高斯；经
                  <strong className="font-semibold text-ink">任何非线性</strong>
                  映射后一般不再服从高斯，需用变量代换重新求密度。
                </div>
              </FieldGroup>
            </>
          )}
        </>
      }
      center={
        tab === 'dist' ? (
          <>
            <Figure
              code="A"
              title="经验 PDF vs 理论密度"
              meta={`${DIST_LABEL[dist]} · M=${n}`}
              height={252}
              draw={drawHistPdf}
              deps={[hist, dist, mu, sigma, a, b, lam, n, bins, seed]}
                          legend={[
                            { label: '经验直方图', color: '#bfdbfe', fill: true },
                            { label: '理论 PDF', color: INK },
                            { label: '理论均值 μ', color: ACCENT, dash: true },
                          ]}
                        />
                        {showEcdf && (
                          <Figure
                            code="B"
                            title="经验 CDF 与理论 CDF"
                            meta={`D_KS 偏差`}
                            height={216}
                            draw={drawEcdfFig}
                            deps={[empCdf, dist, mu, sigma, a, b, lam, seed]}
                            legend={[
                              { label: '经验 ECDF', color: TRACE },
                              { label: '理论 CDF', color: ACCENT },
                            ]}
                          />
                        )}
            <Panel code="C" title="经验统计量与理论值对照" bodyClass="">
              <StatTable rows={statRows} />
              <div className="flex items-center justify-between border-t border-hairline bg-panel px-3 py-[4px]">
                <span className="num text-[9px] text-slate-400">
                  M = {n} · 直方图 [{(lo as number).toFixed(2)}, {(hi as number).toFixed(2)}]
                </span>
                <Badge tone={Math.abs(relError(stats.mean, theory.mean)) < 2 ? 'ok' : 'warn'}>
                  {Math.abs(relError(stats.mean, theory.mean)) < 2 ? '一阶矩一致' : '需增大 M'}
                </Badge>
              </div>
            </Panel>
          </>
        ) : tab === 'clt' ? (
          <>
            <Figure
              code="A"
              title={`标准化和 Y_K 的分布（K = ${K}）`}
              meta={`M=${cltN} · 基分布 ${cltBase}`}
              height={260}
              draw={drawCltHist}
              deps={[clt, K, cltN]}
                          legend={[
                            { label: 'Y_K 经验分布', color: '#bfdbfe', fill: true },
                            { label: 'N(0,1) 理论', color: ACCENT },
                          ]}
                        />
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <Figure code="B" title="正态 Q-Q 检验" meta="偏离 45° 即非正态" height={214} draw={drawQQ} deps={[clt]} />
                          <Figure
                            code="C"
                            title="矩收敛定位"
                            meta={`1/√K 与 1/K 速率`}
                            height={214}
                            draw={drawSkewKurt}
                            deps={[cltCurve, K]}
                            legend={[
                              { label: '|偏度|', color: ACCENT },
                              { label: '|超额峰度|', color: WARN },
                              { label: 'K^{-1/2} 斜率', color: '#cbd5e1', dash: true },
                              { label: 'K^{-1} 斜率', color: '#d6dde6', dash: true },
                            ]}
                          />
                        </div>
            <Panel code="D" title="中心极限定理数值面板" bodyClass="">
              <StatTable
                rows={[
                  { label: '均值', symbol: 'E[Y]', empirical: clt.m.mean, theoretical: 0 },
                  { label: '方差', symbol: 'Var[Y]', empirical: clt.m.variance, theoretical: 1 },
                                  { label: '偏度', symbol: 'γ₁', empirical: clt.m.skewness, theoretical: cltTheory.skew },
                                  { label: '峰度', symbol: 'γ₂', empirical: clt.m.kurtosis, theoretical: cltTheory.kurt },
                ]}
              />
              <div className="border-t border-hairline px-3 py-1.5 text-[10px] leading-[1.5] text-slate-500">
                              收敛速率由 Edgeworth 展开决定：偏度按 <Tex>{String.raw`O(K^{-1/2})`}</Tex> 衰减，超额峰度按{' '}
                              <Tex>{String.raw`O(K^{-1})`}</Tex> 衰减。当前 K={K}，<Tex>{String.raw`1/\sqrt{K}`}</Tex> ={' '}
                              {Math.sqrt(K).toFixed(3)}，故偏度理论量级约为{' '}
                              {(cltCurve.baseSkew / Math.sqrt(K)).toFixed(4)}。
                            </div>
            </Panel>
          </>
        ) : (
          <>
            <Figure
              code="A"
              title="输出概率密度与理论曲线"
              meta={`σ=${mapSigma.toFixed(2)}`}
              height={268}
              draw={drawNonlin}
              deps={[nonlin, map, mapSigma]}
                          legend={[
                            { label: '经验直方图', color: '#bfdbfe', fill: true },
                            { label: '理论输出 PDF', color: ACCENT },
                            ...(map === 'half' ? [{ label: '零点原子 δ(y)', color: WARN, dash: true }] : []),
                          ]}
                        />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Figure
                code="B"
                title="映射关系 y = g(x)"
                meta="灰色为样本散布"
                height={214}
                draw={drawMapping}
                deps={[nonlin, map, mapSigma]}
              />
              <Panel code="C" title="输出矩对照" bodyClass="">
                <StatTable rows={statRows} />
                <div className="border-t border-hairline px-3 py-1.5">
                  <Tex>{String.raw`\text{输出偏度 } \gamma_1 = `}</Tex>
                  <span className="num ml-1 text-[11px] text-ink">{fmt(nonlin.m.skewness, 3)}</span>
                  <span className="num ml-3 text-[9px] text-slate-400">
                    峰度 {fmt(nonlin.m.kurtosis, 3)} （高斯为 3）
                  </span>
                </div>
              </Panel>
            </div>
          </>
        )
      }
      right={
        <>
          <FormulaCard items={formulaItems} />
          <DiagnosisPanel
            items={tab === 'dist' ? diag : tab === 'clt' ? cltDiag : nonlinDiag}
            verdict={tab === 'dist' ? '矩一致性检查' : tab === 'clt' ? '收敛性检查' : '非线性校验'}
            verdictTone={tab === 'dist' ? 'ok' : tab === 'clt' ? 'info' : 'warn'}
            state={
              tab === 'dist'
                ? {
                    module: 'fundamentals/distribution',
                    distribution: dist,
                    params: { mu, sigma, a, b, lambda: lam },
                    samples: n,
                    bins,
                    empirical: { mean: stats.mean, variance: stats.variance, skew: stats.skewness, kurt: stats.kurtosis },
                    theoretical: theory,
                  }
                : tab === 'clt'
                  ? {
                      module: 'fundamentals/clt',
                      base: cltBase,
                      K,
                      samples: cltN,
                      empirical: { mean: clt.m.mean, variance: clt.m.variance, skew: clt.m.skewness, kurt: clt.m.kurtosis },
                      theoretical: { mean: 0, variance: 1, skew: 0, kurt: 3 },
                    }
                  : {
                      module: 'fundamentals/nonlinear',
                      mapping: map,
                      sigma: mapSigma,
                      empirical: { mean: nonlin.m.mean, variance: nonlin.m.variance },
                      theoretical: nonlin.thy,
                    }
            }
          />
          <Steps
            items={
              tab === 'clt'
                ? [
                    {
                      q: '为什么除以 √K 而不是 K？',
                      a: 'Var[ΣX_i] = Kσ²，除以 √K 后方差恒为 σ²再标准化即为 1。除以 K 会使方差按 1/K 收缩，分布退化为 δ 函数，看不到形状收敛。',
                    },
                    {
                      q: 'K = 1 时分布长什么样？',
                      a: '就是把原始分布标准化，因此完全保留原分布的偏度与峰度。把 K 从 1 拖到 12，可以观察到偏度按 1/√K 收缩。',
                    },
                    {
                      q: '为什么双峰收敛最慢？',
                      a: '收敛速率由三阶矩（偏度）决定；双峰分布虽偏度为 0，但其六阶矩较大，Edgeworth 展开的高阶项衰减慢，中心凹陷直至 K ≈ 6 才明显填平。',
                    },
                  ]
                : [
                    {
                      q: '理论曲线为什么不完全贴合直方图？',
                      a: '经验 PDF 的每个箱估计方差约为 p(1-p)/(M·Δ²)，M 有限时必然抖动。增加 M 或增大箱宽可降低方差，但后者引入偏差。',
                    },
                    {
                      q: '如何判断样本数是否足够？',
                      a: '均值的标准误为 σ/√M。当前理论标准误为 ' +
                        fmt(theory.variance / Math.sqrt(n), 4) +
                        '，若它与经验误差同量级，说明差异来自抽样波动而非实现错误。',
                    },
                    {
                      q: '为什么要同时看 PDF 和 CDF？',
                      a: 'PDF 对箱宽敏感，适合定性观察形状；CDF 单调且有 K-S 统计量，适合定量检验拟合优度。',
                    },
                  ]
            }
          />
        </>
      }
    />
  );
}

/* --------------------------------------------------- 标准正态分位数近似 */

function invNormal(p: number): number {
  // Peter Acklam 有理逼近，相对误差 < 1.15e-9
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}