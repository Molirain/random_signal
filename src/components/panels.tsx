import React, { useMemo, useState } from 'react';
import { Tex, Panel, Badge } from './ui';

export type Tone = 'ok' | 'warn' | 'bad' | 'info';

export type DiagItem = {
  tone: Tone;
  title: string;
  body: string;
};

const toneStyles: Record<Tone, { bar: string; dot: string; label: string }> = {
  ok: { bar: 'border-l-[#94a3b8]', dot: 'bg-[#0f172a]', label: '通过' },
  info: { bar: 'border-l-[#cbd5e1]', dot: 'bg-[#64748b]', label: '观察' },
  warn: { bar: 'border-l-warn', dot: 'bg-warn', label: '注意' },
  bad: { bar: 'border-l-warn', dot: 'bg-warn', label: '偏离' },
};

export function DiagnosisPanel({
  items,
  verdict,
  verdictTone = 'info',
  state,
  extra,
}: {
  items: DiagItem[];
  verdict: string;
  verdictTone?: Tone;
  state?: Record<string, unknown>;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(state ?? {}, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel
      code="D"
      title="诊断与推断"
      right={<Badge tone={verdictTone === 'ok' ? 'ok' : verdictTone === 'warn' ? 'warn' : 'neutral'}>{verdict}</Badge>}
      bodyClass="divide-y divide-[#f1f5f9]"
    >
      {items.map((it, i) => {
        const s = toneStyles[it.tone];
        return (
          <div key={i} className={`border-l-2 ${s.bar} py-[6px] pl-2.5 pr-3`}>
            <div className="flex items-baseline gap-1.5">
              <span className={`mt-[5px] inline-block h-[4px] w-[4px] shrink-0 ${s.dot}`} />
              <span className="text-[10.5px] font-semibold text-ink">{it.title}</span>
              <span className="num ml-auto text-[8px] uppercase tracking-wider text-slate-400">
                {s.label}
              </span>
            </div>
            <p className="mt-[2px] pl-[9px] text-[10px] leading-[1.5] text-slate-600">{it.body}</p>
          </div>
        );
      })}
      {extra}
      {state && (
        <div className="px-3 py-[6px]">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="num flex w-full items-center justify-between text-[9px] uppercase tracking-[0.1em] text-slate-400 hover:text-slate-600"
          >
            <span>诊断状态 JSON</span>
            <span className="text-[10px]">{open ? '−' : '+'}</span>
          </button>
          {open && (
            <>
              <pre className="num mt-1 max-h-[190px] overflow-auto border border-hairline bg-panel p-2 text-[9px] leading-[1.45] text-slate-600">
                {JSON.stringify(state, null, 2)}
              </pre>
              <button
                type="button"
                onClick={copy}
                className="num mt-1 border border-hairline px-1.5 py-[2px] text-[9px] text-slate-500 hover:bg-panel hover:text-ink"
              >
                {copied ? '已复制' : '复制快照'}
              </button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export function FormulaCard({
  title = '理论公式',
  items,
  footer,
}: {
  title?: string;
  items: { label?: string; tex: string; note?: string }[];
  footer?: React.ReactNode;
}) {
  return (
    <Panel code="F" title={title} bodyClass="divide-y divide-[#f1f5f9]">
      {items.map((it, i) => (
        <div key={i} className="px-3 py-[7px]">
          {it.label && (
            <div className="mb-[3px] text-[9.5px] font-medium uppercase tracking-[0.06em] text-slate-400">
              {it.label}
            </div>
          )}
          <div className="overflow-x-auto text-[11px] text-ink">
            <Tex display>{it.tex}</Tex>
          </div>
          {it.note && <p className="mt-[3px] text-[9.5px] leading-[1.45] text-slate-500">{it.note}</p>}
        </div>
      ))}
      {footer && <div className="px-3 py-[6px]">{footer}</div>}
    </Panel>
  );
}

export function Workbench({
  controls,
  center,
  right,
}: {
  controls: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-[236px_minmax(0,1fr)] xl:grid-cols-[244px_minmax(0,1fr)_336px]">
          <aside className="border border-hairline bg-white md:sticky md:top-[46px] md:max-h-[calc(100vh-58px)] md:overflow-y-auto">
        {controls}
      </aside>
      <div className="min-w-0 space-y-3">{center}</div>
      <div className="space-y-3 md:col-span-2 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 xl:col-span-1 xl:block xl:space-y-3 xl:sticky xl:top-[46px] xl:max-h-[calc(100vh-58px)] xl:overflow-y-auto">
        {right}
      </div>
    </div>
  );
}

export function ControlHead({ chapter, name }: { chapter: string; name: string }) {
  return (
    <div className="border-b border-hairline px-3 py-2">
      <div className="num text-[8.5px] uppercase tracking-[0.14em] text-accent">{chapter}</div>
      <div className="text-[11.5px] font-semibold text-ink">{name}</div>
    </div>
  );
}

export function Steps({ items, title = '推导提示' }: { items: { q: string; a: string }[]; title?: string }) {
  return (
    <Panel code="S" title={title} bodyClass="px-3 py-1">
      <ol className="space-y-0">
        {items.map((it, i) => (
          <li key={i} className="border-b border-[#f1f5f9] py-[6px] last:border-b-0">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-baseline gap-1.5 text-[10.5px] text-slate-700 hover:text-accent">
                <span className="num text-[9px] text-slate-400">{String(i + 1).padStart(2, '0')}</span>
                {it.q}
                <span className="ml-auto text-[9px] text-slate-300 group-open:hidden">展开</span>
              </summary>
              <p className="mt-1 pl-[22px] text-[10px] leading-[1.55] text-slate-600">{it.a}</p>
            </details>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
