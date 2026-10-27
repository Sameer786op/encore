import type { ReactNode } from "react";

export function Row({ title, body, children }: { title: string; body?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[54px] items-center gap-6 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold">{title}</div>
        {body && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{body}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** a titled group of settings: a small label over a tile of rows */
export function Group({ id, title, action, children }: { id?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-9 scroll-mt-20">
      <div className="mb-2.5 flex items-center justify-between px-5">
        <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="fill-group rounded-[24px] px-5">{children}</div>;
}
