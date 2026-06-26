/**
 * Forbid static-string messages in throwHttpErrorWithCustomMessage.
 *
 * throwHttpErrorWithCustomMessage overrides only the free-text `message`;
 * the base key's messageKey (what the frontend translates) is unchanged.
 * Static messages are therefore either noise (restating the key) or a distinct
 * case that deserves its own error key + messageKey. Dynamic detail (an
 * interpolated id/count/field) is the function's legitimate purpose and is allowed.
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow static messages in throwHttpErrorWithCustomMessage — use a template literal with interpolation, or add a proper error key.",
    },
    schema: [],
    messages: {
      static:
        "throwHttpErrorWithCustomMessage is for dynamic detail only — pass a template literal with ${…} interpolation, or use throwHttpError with a proper error key.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          node.callee.name !== "throwHttpErrorWithCustomMessage"
        ) {
          return;
        }
        const messageArg = node.arguments[1];
        if (!messageArg) return;

        // Static string literal: "foo"
        if (messageArg.type === "Literal" && typeof messageArg.value === "string") {
          context.report({ node: messageArg, messageId: "static" });
          return;
        }
        // Template literal with no interpolation: `foo`
        if (
          messageArg.type === "TemplateLiteral" &&
          messageArg.expressions.length === 0
        ) {
          context.report({ node: messageArg, messageId: "static" });
        }
      },
    };
  },
};
