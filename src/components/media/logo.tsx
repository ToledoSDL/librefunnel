export const LOGO = {
  viewBox: "6 5 52 52",
  ring: "M41.2 20.9A16 16 0 1 1 22.8 20.9",
  stroke: 7,
  dot: { cx: 32, cy: 13, r: 5 },
};

export function Logo() {
  return (
    <svg width={24} height={24} viewBox={LOGO.viewBox} aria-hidden style={{ color: "var(--primary)", flex: "none" }}>
      <path d={LOGO.ring} fill="none" stroke="currentColor" strokeWidth={LOGO.stroke} strokeLinecap="round" />
      <circle {...LOGO.dot} fill="currentColor" />
    </svg>
  );
}
