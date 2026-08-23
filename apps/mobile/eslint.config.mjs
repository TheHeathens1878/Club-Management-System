import base from "../../eslint.config.mjs";

export default [
  ...base,
  {
    ignores: ["expo-env.d.ts", ".expo/**", "android/**", "ios/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: {
        __DEV__: "readonly",
      },
    },
  },
  {
    files: ["*.js", "metro.config.js", "babel.config.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
