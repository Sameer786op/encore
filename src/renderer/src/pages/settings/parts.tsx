import type { ReactNode } from "react";

export function Row({ title, body, children }: { title: string; body?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-6 border-b border-white/[0.07] py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        {body && <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{body}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** a titled group of settings, the way iOS Settings lays them out */
export function Group({ id, title, action, children }: { id?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-20">
      <div className="mb-2 flex items-center justify-between px-4">
        <h2 className="text-[13px] font-semibold text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <div className="fill-group rounded-[20px] px-5">{children}</div>;
}
