import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/* ------------------------------------------------------------------ 公式 */

export function Tex({
  children,
  display = false,
  className = '',
  size,
}: {
  children: string;
  display?: boolean;
  className?: string;
  size?: number;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(children, {
        displayMode: display,
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
        trust: false,
      });
    } catch {
      return `<code>${children}</code>`;
    }
  }, [children, display]);
  return (
    <span
      className={`${display ? 'block' : 'inline-block'} ${className}`}
      style={size ? { fontSize: size } : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ------------------------------------------------------------------ 面板 */

export function Panel({
  title,
  code,
  right,
  children,
  className = '',
  bodyClass = '',
}: {
  title: string;
  code?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`border border-hairline bg-white ${className}`}>
      <header className="flex items-center justify-between border-b border-hairline bg-panel px-3 py-[7px]">
        <div className="flex min-w-0 items-baseline gap-2">
          {code && <span className="num text-[9px] font-semibold tracking-wider text-accent">{code}</span>}
          <h2 className="truncate text-[11.5px] font-semibold tracking-[0.02em] text-ink">{title}</h2>
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ 控件 */

const labelCls = 'text-[11px] leading-[1.35] text-slate-600';
const valueCls = 'num text-[11px] font-medium text-ink';

export function Slider({
  label,
  symbol,
  value,
  min,
  max,
  step = 1,
  unit = '',
  digits = 2,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  symbol?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  digits?: number;
  onChange: (v: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={`px-3 py-[7px] ${disabled ? 'opacity-40' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <label className={labelCls}>
          {label}
          {symbol && <span className="ml-1.5 num text-[10px] text-slate-400">{symbol}</span>}
        </label>
        <span className={valueCls}>
          {value.toFixed(digits)}
          {unit && <span className="ml-0.5 text-[9px] font-normal text-slate-500">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        className="mt-1"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
      />
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-slate-400">{hint}</p>}
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  width = 'w-[86px]',
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  width?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = parseFloat(draft);
    if (!isFinite(v)) {
      setDraft(String(value));
      return;
    }
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    setDraft(String(c));
    onChange(c);
  };
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-[6px]">
      <label className={labelCls}>{label}</label>
      <div className="flex items-center">
        <input
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          className={`num ${width} border border-hairline bg-white px-1.5 py-[2px] text-right text-[11px] text-ink outline-none focus:border-accent`}
        />
        {unit && <span className="ml-1 w-5 text-[9px] text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  columns,
}: {
  label?: string;
  options: { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div className="px-3 py-[6px]">
      {label && <div className={`${labelCls} mb-1`}>{label}</div>}
      <div
        className="grid border border-hairline"
        style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0,1fr))` }}
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              title={o.title}
              onClick={() => onChange(o.value)}
              className={`border-r border-hairline px-1.5 py-[5px] text-[10.5px] leading-tight transition-colors last:border-r-0 ${
                active
                  ? 'bg-accent font-medium text-white'
                  : 'bg-white text-slate-600 hover:bg-panel hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 px-3 py-[6px]">
      <div>
        <div className="text-[11px] leading-[1.35] text-slate-600">{label}</div>
        {hint && <div className="text-[10px] leading-tight text-slate-400">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative mt-[2px] h-[14px] w-[26px] shrink-0 border transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-slate-300 bg-white'
        }`}
      >
        <span
          className={`absolute top-[1px] h-[10px] w-[10px] transition-all ${
            checked ? 'left-[13px] bg-white' : 'left-[1px] bg-slate-400'
          }`}
        />
      </button>
    </div>
  );
}

export function FieldGroup({
  title,
  children,
  note,
}: {
  title: string;
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="border-b border-hairline last:border-b-0">
      <div className="flex items-baseline justify-between bg-panel/60 px-3 py-[4px]">
        <span className="num text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-500">
          {title}
        </span>
        {note && <span className="num text-[9px] text-slate-400">{note}</span>}
      </div>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  className = '',
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'warn';
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const styles =
    variant === 'primary'
      ? 'border-accent bg-accent text-white hover:bg-[#1d4ed8]'
      : variant === 'ghost'
        ? 'border-transparent bg-transparent text-slate-600 hover:bg-panel hover:text-ink'
        : variant === 'warn'
          ? 'border-warn bg-white text-warn hover:bg-[#fff7ed]'
          : 'border-hairline bg-white text-slate-700 hover:bg-panel';
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`border px-2 py-[3px] text-[10.5px] font-medium leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ 数据表 */

export type StatRow = {
  label: string;
  symbol?: string;
  empirical: number;
  theoretical: number;
  digits?: number;
  unit?: string;
};

export function StatTable({ rows, compact = false }: { rows: StatRow[]; compact?: boolean }) {
  return (
    <table className="w-full border-collapse text-[10.5px]">
      <thead>
        <tr className="border-b border-hairline text-[9px] uppercase tracking-[0.08em] text-slate-400">
          <th className="py-[4px] pl-3 pr-1 text-left font-medium">统计量</th>
          <th className="px-1 py-[4px] text-right font-medium">经验值</th>
          <th className="px-1 py-[4px] text-right font-medium">理论值</th>
          <th className="py-[4px] pl-1 pr-3 text-right font-medium">相对误差</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
                  const nearZero = !isFinite(r.theoretical) || Math.abs(r.theoretical) < 1e-9;
                  const err = nearZero ? NaN : ((r.empirical - r.theoretical) / Math.abs(r.theoretical)) * 100;
                  const dev = r.empirical - r.theoretical;
                  const bad = isFinite(err) && Math.abs(err) > 5;
                  const mid = isFinite(err) && Math.abs(err) > 1.5;
                  const d = r.digits ?? (compact ? 3 : 4);
                  return (
                    <tr key={r.label} className="border-b border-[#f1f5f9] last:border-b-0">
                      <td className="py-[3px] pl-3 pr-1 text-slate-600">
                        {r.label}
                        {r.symbol && <span className="ml-1 num text-[9px] text-slate-400">{r.symbol}</span>}
                      </td>
                      <td className="num px-1 py-[3px] text-right text-ink">
                        {isFinite(r.empirical) ? r.empirical.toFixed(d) : '—'}
                      </td>
                      <td className="num px-1 py-[3px] text-right text-slate-500">
                        {isFinite(r.theoretical) ? r.theoretical.toFixed(d) : '—'}
                      </td>
                      <td
                        className={`num py-[3px] pl-1 pr-3 text-right ${
                          bad ? 'text-warn' : mid ? 'text-slate-500' : 'text-slate-400'
                        }`}
                      >
                        {isFinite(err)
                          ? `${err >= 0 ? '+' : '−'}${Math.abs(err).toFixed(2)}%`
                          : isFinite(dev)
                            ? `Δ${dev >= 0 ? '+' : '−'}${Math.abs(dev).toFixed(d)}`
                            : '—'}
                      </td>
                    </tr>
                  );
                })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ Canvas */

export function CanvasPlot({
  height,
  draw,
  deps,
  label,
  className = '',
  onPointer,
}: {
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  deps: unknown[];
  label?: string;
  className?: string;
  onPointer?: (e: React.PointerEvent<HTMLCanvasElement>, w: number, h: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const render = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(80, Math.floor(rect.width));
    const h = height;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    drawRef.current(ctx, w, h);
  }, [height]);

  useLayoutEffect(() => {
      // 每次渲染后重绘：绘图数据全部来自父组件的 useMemo，
      // 因此无需（也不应）依赖长度可变的 deps 数组。
      render();
    });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [render]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={label ?? '数据图表'}
      className={`block w-full ${className}`}
      style={{ height }}
      onPointerMove={onPointer ? (e) => onPointer(e, e.currentTarget.clientWidth, height) : undefined}
    />
  );
}

export function Figure({
  code,
  title,
  meta,
  height,
  draw,
  deps,
  note,
  legend,
  caption,
}: {
  code: string;
  title: string;
  meta?: string;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  deps: unknown[];
  note?: React.ReactNode;
  legend?: { label: string; color: string; dash?: boolean; fill?: boolean }[];
  caption?: string;
}) {
  return (
    <div className="border border-hairline bg-white">
      <div className="flex items-baseline gap-2 border-b border-hairline bg-panel px-2.5 py-[5px]">
        <span className="num text-[9px] font-semibold text-accent">{code}</span>
        <span className="text-[11px] font-medium text-ink">{title}</span>
          {meta && <span className="num ml-auto shrink-0 truncate pl-2 text-[8.5px] text-slate-400">{meta}</span>}
      </div>
      <div className="px-1 pb-1 pt-[6px]">
        <CanvasPlot height={height} draw={draw} deps={deps} label={title} />
      </div>
      {legend && legend.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#f1f5f9] px-2.5 py-[4px]">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-[2px] w-[13px]"
                style={{
                  background: l.fill ? l.color : undefined,
                  borderTop: l.dash ? `2px dashed ${l.color}` : undefined,
                  backgroundColor: l.dash ? undefined : l.color,
                  opacity: l.fill ? 0.45 : 1,
                }}
              />
              <span className="num text-[8.5px] text-slate-500">{l.label}</span>
            </span>
          ))}
        </div>
      )}
      {(note || caption) && (
        <div className="border-t border-[#f1f5f9] px-2.5 py-[5px] text-[10px] leading-[1.45] text-slate-500">
          {note}
          {caption && <span className="num block text-[9px] text-slate-400">{caption}</span>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 其它 */

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'blue' | 'warn' | 'ok';
}) {
  const map = {
    neutral: 'border-slate-200 bg-panel text-slate-500',
    blue: 'border-[#bfdbfe] bg-[#eff6ff] text-accent',
    warn: 'border-[#fde3b8] bg-[#fff7ed] text-warn',
    ok: 'border-[#cbd5e1] bg-white text-ink',
  } as const;
  return (
    <span
      className={`num inline-flex items-center border px-1.5 py-[1px] text-[9px] font-medium tracking-wide ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function SectionHead({
  index,
  cn,
  en,
}: {
  index: string;
  cn: string;
  en: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="num text-[10px] font-semibold text-accent">{index}</span>
      <h1 className="text-[15px] font-semibold tracking-[0.01em] text-ink">{cn}</h1>
      <span className="num text-[9.5px] uppercase tracking-[0.12em] text-slate-400">{en}</span>
    </div>
  );
}