// ESLint exists in this repo ONLY to host the custom rule in
// eslint-rules/no-static-custom-http-error-message.mjs. All built-in rules
// are off; deno lint remains the project's primary linter.
import tsParser from "@typescript-eslint/parser";
import noStaticCustomHttpErrorMessage from "./eslint-rules/no-static-custom-http-error-message.mjs";

export default [
  {
    ignores: [
      "admin-ui/**",
      "static/**",
      "tests/**",
      "node_modules/**",
      "scripts/**",
      "coverage/**",
      "db/seed/**",
      "eslint-rules/**",
    ],
  },
  {
    // The rule is enforced repo-wide. All static throwHttpErrorWithCustomMessage
    // call sites have been converted to proper error keys; only dynamic
    // (interpolated) messages remain, which the rule allows.
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      local: {
        rules: {
          "no-static-custom-http-error-message": noStaticCustomHttpErrorMessage,
        },
      },
    },
    rules: {
      "local/no-static-custom-http-error-message": "error",
    },
  },
];
