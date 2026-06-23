module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "plugin:storybook/recommended",
  ],
  // src/vendor = vendored upstream zmk-studio-ts-client fork (do not lint third-party code)
  ignorePatterns: [
    "dist",
    "dist-electron",
    "release",
    ".eslintrc.cjs",
    "src/vendor",
  ],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
  },
};
