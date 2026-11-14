import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // These screens fetch on mount and mirror bus events into local state; that is the
    // "subscribe to an external system" case, which this rule cannot tell apart.
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);

export default eslintConfig;
