import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

export default withMDX({
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  turbopack: { root: import.meta.dirname },
});
