import React, { Suspense, useEffect, useState } from 'react';
import { Badge, SectionHead, Tex } from './components/ui';

const Module1 = React.lazy(() => import('./modules/module1'));
const Module2 = React.lazy(() => import('./modules/module2'));
const Module3 = React.lazy(() => import('./modules/module3'));
const Module4 = React.lazy(() => import('./modules/module4'));

type ModuleId = 1 | 2 | 3 | 4;
const WELCOME_STORAGE_KEY = 'stochaslab-welcome-seen';

const MODULES: {
  id: ModuleId;
  code: string;
  cn: string;
  en: string;
  summary: string;
  topics: string[];
}[] = [
  {
    id: 1,
    code: '01',
    cn: '随机信号基础',
    en: 'Fundamentals',
    summary: '概率密度、数字特征与中心极限定理的蒙特卡洛验证。',
    topics: ['Box–Muller 变换', '直方图与 ECDF', 'CLT 收敛速率', '非线性映射'],
  },
  {
    id: 2,
    code: '02',
    cn: '随机过程与序列',
    en: 'Stochastic Processes',
    summary: '集合与时间的双重切片，平稳性、遍历性与维纳-辛钦定理。',
    topics: ['随机相位正弦', 'AR(1) 过程', '遍历性判据', '周期图 / Welch'],
  },
  {
    id: 3,
    code: '03',
    cn: '线性系统响应',
    en: 'LTI Response',
    summary: '输入输出谱映射 S_Y = |H|²S_X 与时域相关传递的闭环校验。',
    topics: ['IIR / FIR 设计', '等效噪声带宽', '自相关传递', '功率守恒'],
  },
  {
    id: 4,
    code: '04',
    cn: '窄带随机过程',
    en: 'Narrowband',
    summary: '希尔伯特变换解调复包络，瑞利与莱斯包络分布的连续过渡。',
    topics: ['正交分解', '解析信号', '瑞利分布', '莱斯因子 K'],
  },
];

export default function App() {
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [active, setActive] = useState<ModuleId>(() => {
    const hash = window.location.hash.replace('#', '').split('?')[0];
    const n = Number(hash);
    return n >= 1 && n <= 4 ? (n as ModuleId) : 1;
  });

  useEffect(() => {
    if (window.location.hash !== `#${active}`) {
      window.history.replaceState(null, '', `#${active}`);
    }
  }, [active]);

  useEffect(() => {
    try {
      setWelcomeOpen(window.localStorage.getItem(WELCOME_STORAGE_KEY) !== 'true');
    } catch {
      setWelcomeOpen(true);
    }
  }, []);

  const closeWelcome = () => {
    try {
      window.localStorage.setItem(WELCOME_STORAGE_KEY, 'true');
    } catch {
      // 存储不可用时仍允许用户继续使用当前页面。
    }
    setWelcomeOpen(false);
  };

  const meta = MODULES.find((m) => m.id === active)!;

  return (
    <div className="min-h-screen bg-white">
      {welcomeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/35 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
        >
          <div className="w-full max-w-[460px] border border-hairline bg-white shadow-[0_12px_36px_rgba(15,23,42,0.18)]">
            <div className="border-b border-hairline px-5 py-3">
              <div className="num text-[9px] uppercase tracking-[0.16em] text-accent">StochasLab / Welcome</div>
            </div>
            <div className="px-5 py-7">
              <h1 id="welcome-title" className="text-[22px] font-semibold tracking-tight text-ink">
                欢迎来到随机信号学习系统
              </h1>
              <p className="num mt-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">
                designed by Molirain
              </p>
              <p className="mt-5 text-[11px] leading-[1.7] text-slate-600">
                通过四个交互式模块探索随机信号、随机过程、线性系统响应与窄带过程。所有计算均在浏览器本地完成。
              </p>
              <button
                type="button"
                onClick={closeWelcome}
                autoFocus
                className="mt-6 border border-accent bg-accent px-4 py-2 text-[11px] font-medium text-white hover:bg-[#1d4ed8]"
              >
                开始学习
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 顶部条：类 RFC 文档页眉 */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-white">
        <div className="mx-auto flex h-[45px] max-w-[1560px] items-center gap-4 px-4">
          <div className="flex items-baseline gap-2">
            <span className="num text-[12px] font-semibold tracking-[0.02em] text-ink">StochasLab</span>
            <span className="num hidden text-[9px] uppercase tracking-[0.16em] text-slate-400 sm:inline">
              Random Signal Analysis Workbench
            </span>
          </div>
          <nav className="ml-2 hidden items-stretch self-stretch md:flex" aria-label="模块导航">
            {MODULES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setActive(m.id);
                  window.scrollTo({ top: 0, behavior: 'auto' });
                }}
                aria-current={active === m.id ? 'page' : undefined}
                className={`relative border-b-2 px-3 text-[11.5px] transition-colors ${
                                  active === m.id
                                    ? 'border-accent font-medium text-ink'
                                    : 'border-transparent text-slate-500 hover:text-ink'
                                }`}
              >
                <span className="num mr-1.5 text-[9px] text-slate-400">{m.code}</span>
                {m.cn}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="num hidden text-[9px] text-slate-400 lg:inline">
              PURE CLIENT-SIDE · NO SERVER
            </span>
            <span className="inline-flex items-center gap-1 border border-hairline px-1.5 py-[1px]">
              <span className="inline-block h-[5px] w-[5px] bg-[#16a34a]" />
              <span className="num text-[9px] text-slate-500">READY</span>
            </span>
          </div>
        </div>
        {/* 移动端模块选择 */}
        <div className="grid grid-cols-4 border-t border-hairline md:hidden">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setActive(m.id);
                window.scrollTo({ top: 0, behavior: 'auto' });
              }}
              className={`border-r border-hairline px-1 py-[5px] text-[10px] last:border-r-0 ${
                              active === m.id ? 'bg-accent text-white' : 'bg-white text-slate-600'
                            }`}
            >
              <span className="num mr-1 text-[8.5px] opacity-70">{m.code}</span>
              {m.cn}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] px-4 pb-10 pt-4">
        {/* 页眉信息带 */}
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-hairline pb-2">
          <div>
            <SectionHead index={`${meta.code} / CH.${active}`} cn={meta.cn} en={meta.en} />
            <p className="mt-1 max-w-[720px] text-[11px] leading-[1.55] text-slate-500">{meta.summary}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {meta.topics.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        </div>

        <Suspense
          fallback={
            <div className="border border-hairline bg-panel px-4 py-10 text-center">
              <span className="num text-[11px] text-slate-500">正在初始化蒙特卡洛引擎…</span>
            </div>
          }
        >
          {active === 1 && <Module1 />}
          {active === 2 && <Module2 />}
          {active === 3 && <Module3 />}
          {active === 4 && <Module4 />}
        </Suspense>

        {/* 页脚：文献引用与实现说明 */}
        <footer className="mt-6 border-t border-hairline pt-3">
          <div className="grid grid-cols-1 gap-4 text-[10px] leading-[1.6] text-slate-500 md:grid-cols-4">
            <div>
              <div className="num mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">
                计算内核
              </div>
              全部实现于浏览器主线程：mulberry32 伪随机数、Box–Muller 正态变换、radix-2 迭代 FFT、
              频域希尔伯特变换、RBJ 双二阶滤波器、Welch 平均周期图。无任何网络请求与后端依赖。
            </div>
            <div>
              <div className="num mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">
                数值约定
              </div>
              频率以 Hz 标注；功率谱为<b className="font-semibold text-slate-600">单边</b>密度（幅值²/Hz）。
              自相关默认使用有偏估计 1/N，可在模块二切换为 1/(N−|m|)。
            </div>
            <div>
              <div className="num mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">
                教学要点
              </div>
              观测值偏离理论值时，先判断是抽样波动、估计器偏差还是系统建模误差；诊断面板给出的相对误差均已标注判定阈值。
            </div>
            <div>
              <div className="num mb-1 text-[9px] uppercase tracking-[0.12em] text-slate-400">
                参考
              </div>
              <div className="space-y-[1px]">
                <div>
                  A. Papoulis, <i>Probability, Random Variables and Stochastic Processes</i>
                </div>
                <div>
                  J. G. Proakis, <i>Digital Communications</i>, Ch. 5
                </div>
                <div>RBJ Audio EQ Cookbook, 二阶节设计公式</div>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f1f5f9] pt-2">
            <span className="num text-[9px] text-slate-400">
              Stochastic Simulation Workbench · React 18 + Canvas 2D + KaTeX · 静态部署 (Cloudflare Pages)
            </span>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-slate-400">
              <a
                href="https://github.com/molirain"
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                GitHub / Molirain
              </a>
              <a href="mailto:contact@molirain.com" className="text-accent hover:underline">
                contact@molirain.com
              </a>
              <span className="hidden text-slate-300 sm:inline">·</span>
              <span className="hidden sm:inline">
                <Tex>{String.raw`S_Y(\omega)=|H(\omega)|^2S_X(\omega)`}</Tex>
                <span className="mx-2 text-slate-300">·</span>
                <Tex>{String.raw`R_X(\tau)\;\overset{\mathcal{F}}{\longleftrightarrow}\;S_X(\omega)`}</Tex>
              </span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}