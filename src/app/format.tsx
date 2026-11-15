const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
const TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

export function Money({ cents }: { cents: number }) {
  return <span suppressHydrationWarning>{BRL.format(cents / 100)}</span>;
}

export function DateTime({ at }: { at: Date }) {
  return (
    <time dateTime={at.toISOString()} suppressHydrationWarning>
      {DAY.format(at)} às {TIME.format(at)}
    </time>
  );
}
