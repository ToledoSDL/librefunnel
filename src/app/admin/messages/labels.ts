import type { Conversation, InboxFilter } from "@/lib/dashboard";
import { href } from "../shared";

const ZONE = "America/Sao_Paulo";
const DAY = new Intl.DateTimeFormat("pt-BR", { timeZone: ZONE, day: "2-digit", month: "2-digit" });
const TIME = new Intl.DateTimeFormat("pt-BR", { timeZone: ZONE, hour: "2-digit", minute: "2-digit" });

const SYSTEMS: [string, RegExp][] = [
  ["iPhone", /iPhone/],
  ["iPad", /iPad/],
  ["Android", /Android/],
  ["Windows", /Windows/],
  ["Mac", /Mac OS X/],
  ["Linux", /Linux/],
];

const BROWSERS: [string, RegExp][] = [
  ["navegador do Instagram", /Instagram/],
  ["navegador do Facebook", /FBAN|FBAV/],
  ["Edge", /Edg\//],
  ["Samsung Internet", /SamsungBrowser/],
  ["Chrome", /CriOS|Chrome\//],
  ["Firefox", /Firefox\/|FxiOS/],
  ["Safari", /Safari\//],
];

export const KIND_LABEL: Record<string, string> = {
  access: "Link de acesso",
  paid: "Pagamento confirmado",
  recovery: "Recuperação",
  login: "Link de login",
  reply: "Resposta automática",
  owner: "Aviso de venda",
  invoice: "Nota fiscal",
};

export function contactLabel(address: string): string {
  const phone = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(address);

  return phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : address;
}

export function conversationHref(filter: InboxFilter, open?: Conversation) {
  return href("messages", {
    ...(filter === "all" ? {} : { show: filter }),
    ...(open ? { c: `${open.channel}:${open.address}` } : {}),
  });
}

export function time(at: Date): string {
  return TIME.format(at);
}

export function day(at: Date): string {
  const label = DAY.format(at);

  if (label === DAY.format(new Date())) return "Hoje";
  if (label === DAY.format(new Date(Date.now() - 86_400_000))) return "Ontem";
  return label;
}

export function photoHref(address: string, version: number | null): string | undefined {
  return version === null
    ? undefined
    : `/admin/messages/photo?${new URLSearchParams({ a: address, v: String(version) })}`;
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} min${seconds < 600 && seconds % 60 ? ` ${seconds % 60} s` : ""}`;
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
}

// Enough to know where the buyer was: the system, and the in-app browser of Instagram or Facebook when it was one.
export function device(agent: string): string {
  return [SYSTEMS, BROWSERS]
    .flatMap((options) => options.find(([, pattern]) => pattern.test(agent))?.[0] ?? [])
    .join(" · ");
}

// The list shows the hour for today and only the day for anything older.
export function shortWhen(at: Date): string {
  const label = day(at);

  return label === "Hoje" ? time(at) : label;
}
