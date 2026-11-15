// Every text the store formats for people, on the server and in the browser: money, documents, phones and names.
export function formatFirstName(name: string): string {
  return (name.split(" ")[0] ?? "").replace(/[^\p{L}'-]/gu, "").slice(0, 30);
}

export function formatMaskedEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatMoney(cents: number): string {
  return BRL.format(cents / 100);
}

// While typing: (48) 99999-0000.
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length > 11) return value;
  if (digits.length > 6) return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  if (digits.length > 2) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return digits;
}

// A stored 55-prefixed number as people write it; e-mails pass through.
export function formatContact(address: string): string {
  const phone = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(address);

  return phone ? `(${phone[1]}) ${phone[2]}-${phone[3]}` : address;
}

export function formatDocument(digits: string): string {
  return digits.length === 11
    ? digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
    : digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

// "03 - como-precificar.mp4" becomes "Como precificar".
export function formatFileTitle(fileName: string): string {
  const text = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/^\s*\d+\s*[-_.)]*\s*/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatTitleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

// Plain decimal text: "97.00" for APIs, "97,00" for spreadsheets.
export function formatDecimal(cents: number, separator: "." | "," = "."): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${Math.floor(Math.abs(cents) / 100)}${separator}${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

export function formatSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

// The value a datetime-local input takes, in the server's time zone (Brasília in the image).
export function formatLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
