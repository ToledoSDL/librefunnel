"use client";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import SearchDialog from "@/components/search";

const translations = {
  "Search(search trigger)": "Buscar",
  "Search(search dialog)": "Buscar na documentação",
  "Open Search(search trigger)(aria-label)": "Abrir busca",
  "Close Search(search dialog)(aria-label)": "Fechar busca",
  "No results found(search dialog)": "Nada encontrado",
  "Search failed(search dialog)": "A busca falhou",
  "On this page(table of contents)": "Nesta página",
  "No Headings(table of contents)": "Sem seções",
  "Table of Contents(inline table of contents)": "Nesta página",
  "Next Page(pagination)": "Próxima",
  "Previous Page(pagination)": "Anterior",
  "Copy Text(code block)(aria-label)": "Copiar",
  "Copied Text(code block)(aria-label)": "Copiado",
  "Copy Anchor Link(heading anchor)(aria-label)": "Copiar link da seção",
  "Copied Anchor Link(heading anchor)(aria-label)": "Link copiado",
  "Toggle Theme(theme switcher)(aria-label)": "Trocar tema",
  "Light(theme switcher)(aria-label)": "Claro",
  "Dark(theme switcher)(aria-label)": "Escuro",
  "System(theme switcher)(aria-label)": "Do sistema",
  "Theme(site menu)": "Tema",
  "Toggle Menu(home layout header)(aria-label)": "Abrir menu",
  "Open Sidebar(aria-label)": "Abrir menu",
  "Open Sidebar(sidebar)(aria-label)": "Abrir menu",
  "Close Sidebar(aria-label)": "Fechar menu",
  "Close Sidebar(sidebar)(aria-label)": "Fechar menu",
  "Collapse Sidebar(sidebar)(aria-label)": "Recolher menu",
  "Hide Sidebar(sidebar)": "Esconder menu",
  "Show Sidebar(sidebar)": "Mostrar menu",
  "Skip to Content(skip link)": "Pular para o conteúdo",
  "Page Not Found(404 not found page)": "Página não encontrada",
  "Back to Home(404 not found page)": "Voltar ao início",
  "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)":
    "O endereço pode ter mudado. A documentação lista todas as páginas.",
};

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog }} i18n={{ locale: "pt-BR", translations }}>
      {children}
    </RootProvider>
  );
}
