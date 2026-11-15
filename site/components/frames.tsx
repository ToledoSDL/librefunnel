import type { ReactNode } from "react";

export function BrowserFrame({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-fd-card shadow-[0_24px_60px_-20px_rgb(20_21_19/0.45)] dark:border-white/10">
      <div className="flex items-center gap-3 border-b border-fd-border bg-fd-muted px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
          <span className="size-2.5 rounded-full bg-fd-border" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-fd-background px-3 py-1 text-center font-mono text-[11px] text-fd-muted-foreground">
          {url}
        </span>
      </div>
      <div className="relative aspect-[16/10]">{children}</div>
    </div>
  );
}

export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[2.25rem] bg-[#181917] p-2 shadow-[0_30px_60px_-24px_rgb(20_21_19/0.6)] ring-1 ring-white/10 ${className}`}
    >
      <div className="relative aspect-[390/844] overflow-hidden rounded-[1.75rem] bg-white">{children}</div>
    </div>
  );
}

export function Shot({ name, alt, eager = false }: { name: string; alt: string; eager?: boolean }) {
  return (
    <img
      src={`/shots/${name}.webp`}
      alt={alt}
      width={780}
      height={1688}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className="absolute inset-0 size-full object-cover object-top"
    />
  );
}

export function ThemedShot({ name, alt, eager = false }: { name: string; alt: string; eager?: boolean }) {
  const loading = eager ? "eager" : "lazy";

  return (
    <>
      <img
        src={`/shots/${name}-light.webp`}
        alt={alt}
        width={1600}
        height={1000}
        loading={loading}
        decoding="async"
        className="absolute inset-0 size-full object-cover object-top dark:hidden"
      />
      <img
        src={`/shots/${name}-dark.webp`}
        alt={alt}
        width={1600}
        height={1000}
        loading={loading}
        decoding="async"
        className="absolute inset-0 hidden size-full object-cover object-top dark:block"
      />
    </>
  );
}
