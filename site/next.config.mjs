import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

export default withMDX({
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  // The repo's AGENTS.md is the single source of instructions, so `next dev` must not write site/AGENTS.md.
  agentRules: false,
  turbopack: { root: import.meta.dirname },
});
