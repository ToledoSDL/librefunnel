"use client";
import { useState } from "react";

const COMMAND = "curl -fsSL https://librefunnel.com/install | sh";

export function InstallCommand() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex w-full max-w-xl items-center gap-2 rounded-full bg-white/95 p-1.5 pl-5 text-[#181917] shadow-sm">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap [scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,#000_80%,transparent)] [&::-webkit-scrollbar]:hidden">
        <span className="text-[#686b64] select-none">$ </span>
        {COMMAND}
      </code>
      <button
        type="button"
        onClick={copy}
        className="min-h-10 shrink-0 rounded-full bg-[#181917] px-4 text-sm font-medium text-white"
      >
        <span aria-live="polite">{copied ? "Copiado" : "Copiar"}</span>
      </button>
    </div>
  );
}
