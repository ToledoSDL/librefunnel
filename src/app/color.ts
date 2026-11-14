// Dark text on light store colors, white on dark ones, so the buy button stays readable whatever the seller picks.
export function inkFor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const light = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);

  return light > 0.55 ? "#141513" : "#ffffff";
}
