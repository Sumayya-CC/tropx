// functions/ intentionally stays on legacy ESLint config (this file) while the
// repo root uses flat config (eslint.config.js). The `lint` script in
// package.json pins ESLINT_USE_FLAT_CONFIG=false so this .eslintrc.js isn't
// pulled into the root's flat-config mode, which doesn't understand the
// `--ext` flag firebase.json's predeploy hook relies on.
module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
    "plugin:import/typescript",
    "google",
    "plugin:@typescript-eslint/recommended",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.dev.json", "tsconfig.spec.json"],
    sourceType: "module",
  },
  ignorePatterns: [
    "/lib/**/*", // Ignore built files.
    "/generated/**/*", // Ignore generated files.
  ],
  plugins: [
    "@typescript-eslint",
    "import",
  ],
  rules: {
    "quotes": ["error", "double"],
    "import/no-unresolved": 0,
    "indent": ["error", 2],
    "max-len": ["error", {"code": 120}],
    "require-jsdoc": "off",
  },
};
