import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const GITHUB = "https://github.com/ToledoSDL/librefunnel";
export const DEMO = "https://demo.librefunnel.com";
export const GUIDE = `${GITHUB}/blob/main/docs/deploy.md`;

export const layoutOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <img src="/icon.svg" width={24} height={24} alt="" />
        <span className="font-bold">LibreFunnel</span>
      </>
    ),
  },
  links: [
    { text: "Docs", url: "/docs/", active: "nested-url" },
    { text: "Demo", url: DEMO, external: true },
  ],
  githubUrl: GITHUB,
};
