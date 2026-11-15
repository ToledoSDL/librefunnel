"use client";
import { useState } from "react";
import { BrowserFrame, ThemedShot } from "@/components/frames";

type Tab = { shot: string; label: string; path: string; text: string };

export function PanelTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="grid gap-6">
      <div role="tablist" aria-label="Telas do painel" className="flex flex-wrap gap-2">
        {tabs.map((tab, index) => (
          <button
            key={tab.shot}
            type="button"
            role="tab"
            id={`panel-tab-${tab.shot}`}
            aria-selected={index === active}
            aria-controls={`panel-${tab.shot}`}
            onClick={() => setActive(index)}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
              index === active
                ? "border-fd-foreground bg-fd-foreground text-fd-background"
                : "border-fd-border hover:border-fd-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.shot}
          role="tabpanel"
          id={`panel-${tab.shot}`}
          aria-labelledby={`panel-tab-${tab.shot}`}
          hidden={index !== active}
          className="grid gap-4"
        >
          <p className="max-w-2xl text-fd-muted-foreground">{tab.text}</p>
          <div className="rise">
            <BrowserFrame url={`loja.seudominio.com.br${tab.path}`}>
              <ThemedShot name={tab.shot} alt={`Painel do LibreFunnel: ${tab.label}`} />
            </BrowserFrame>
          </div>
        </div>
      ))}
    </div>
  );
}
