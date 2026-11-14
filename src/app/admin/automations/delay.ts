export const UNITS = [
  { minutes: 1, label: "minutos", one: "minuto" },
  { minutes: 60, label: "horas", one: "hora" },
  { minutes: 1440, label: "dias", one: "dia" },
] as const;

export function delayParts(minutes: number) {
  const unit = [...UNITS].reverse().find((entry) => minutes % entry.minutes === 0) ?? UNITS[0];

  return { delay: minutes / unit.minutes, unit };
}

export function delayLabel(minutes: number) {
  const { delay, unit } = delayParts(minutes);

  return `${delay} ${delay === 1 ? unit.one : unit.label} depois do Pix`;
}
