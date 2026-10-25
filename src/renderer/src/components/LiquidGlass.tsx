import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { GlassArea } from "@/settings/store";
import { refractionMap } from "@/visuals/refraction";

// A pane of Liquid Glass: the `glass` material plus real refraction along
// its rim (an SVG displacement filter applied to what's behind it) and a
// sheen that follows the pointer. Used for the big floating pieces: the
// sidebar, the player, the toolbar, the queue.

interface LiquidGlassProps extends HTMLAttributes<HTMLDivElement> {
  /** corner radius in px; the refraction follows it */
  radius: number;
  /** how far in from the edge the glass bends, in px */
  bezel?: number;
  /** how far the picture behind is pulled, in px */
  strength?: number;
  /** a highlight that follows the pointer across the glass */
  sheen?: boolean;
  /** the material underneath: the default pane, or the lighter one for controls */
  material?: "glass" | "glass-control";
  /** which of Settings → Appearance's glass areas this pane belongs to; the rest use the general one */
  area?: Exclude<GlassArea, "panels">;
  as?: "div" | "aside" | "footer" | "nav" | "header";
  children?: ReactNode;
}

const supportsRefraction = typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "url(#x)");

export function LiquidGlass({ radius, bezel = 16, strength = 18, sheen = false, material = "glass", area, as: Tag = "div", className, style, children, onPointerMove, onPointerLeave, ...rest }: LiquidGlassProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = `lg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !supportsRefraction) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const map = size && size.w > 0 && size.h > 0 ? refractionMap(size.w, size.h, radius, bezel) : null;
  const blur = material === "glass" ? "var(--glass-blur)" : "16px";
  const glassStyle: CSSProperties = {
    borderRadius: radius,
    ...(map ? { backdropFilter: `blur(${blur}) url(#${id}) saturate(190%)`, WebkitBackdropFilter: `blur(${blur}) url(#${id}) saturate(190%)` } : {}),
    ...style,
  };

  return (
    <Tag
      ref={ref as never}
      data-glass-area={area}
      // the rim and sheen are laid over the pane, so it needs a position of its own
      className={cn(!/\b(absolute|fixed|sticky)\b/.test(className ?? "") && "relative", "isolate", material, className)}
      style={glassStyle}
      onPointerMove={(e) => {
        if (sheen) {
          const rect = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--sheen-x", `${e.clientX - rect.left}px`);
          e.currentTarget.style.setProperty("--sheen-y", `${e.clientY - rect.top}px`);
          e.currentTarget.style.setProperty("--sheen", "1");
        }
        onPointerMove?.(e as never);
      }}
      onPointerLeave={(e) => {
        if (sheen) e.currentTarget.style.setProperty("--sheen", "0");
        onPointerLeave?.(e as never);
      }}
      {...rest}
    >
      {map && size && (
        <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
          <filter id={id} x="0" y="0" width={size.w} height={size.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feImage href={map} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={strength * 2} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {/* light caught on the rim: brightest at the top left, a glint at the bottom right */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-[1]"
        style={{
          borderRadius: radius,
          padding: 1,
          background: "linear-gradient(150deg, rgb(255 255 255 / 0.42), rgb(255 255 255 / 0.06) 28%, rgb(255 255 255 / 0) 55%, rgb(255 255 255 / 0.16))",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
        }}
      />
      {sheen && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-[1] transition-opacity duration-500"
          style={{
            borderRadius: radius,
            opacity: "var(--sheen, 0)",
            background: "radial-gradient(240px circle at var(--sheen-x, 50%) var(--sheen-y, 50%), rgb(255 255 255 / 0.09), transparent 70%)",
          }}
        />
      )}
      {children}
    </Tag>
  );
}
