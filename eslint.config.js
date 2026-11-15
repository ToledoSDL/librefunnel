import stylistic from "@stylistic/eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "site/**"] },
  {
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "multiline-const", next: "*" },
        { blankLine: "always", prev: "*", next: "multiline-const" },
      ],
    },
  },
);
