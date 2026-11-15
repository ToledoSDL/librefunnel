import "server-only";
import QRCode from "qrcode";
import type { Product } from "../catalog";

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Static BR Code per BCB "Manual de Padroes para Iniciacao do Pix"; key, name and city are normalized when saved.
export function brCode(pix: Product["pix"], amount: number | null, txid: string): string {
  const value =
    amount === null ? "" : tlv("54", `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`);

  const body =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", pix.key)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    value +
    tlv("58", "BR") +
    tlv("59", pix.name) +
    tlv("60", pix.city) +
    tlv("62", tlv("05", txid)) +
    "6304";

  return body + crc16(body);
}

export function pixQrSvg(pixCode: string): Promise<string> {
  return QRCode.toString(pixCode, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
