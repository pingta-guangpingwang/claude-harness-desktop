import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import prettier from "eslint-config-prettier";

export default [
  // Global ignores
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "electron/*.js",
      "electron/modules/*.js",
      "**/*.d.ts",
    ],
  },

  // Base TypeScript config
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react: reactPlugin,
    },
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],

      // General
      "no-console": "off",
      "prefer-const": "warn",
      "no-debugger": "warn",
    },
  },

  // React files
  {
    files: ["src/**/*.tsx"],
    rules: {
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
    },
    settings: {
      react: { version: "19.0" },
    },
  },

  // Electron / Node files
  {
    files: ["electron/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        __dirname: "readonly",
        console: "readonly",
      },
    },
  },

  // Prettier — must be last to override stylistic rules
  prettier,
];
