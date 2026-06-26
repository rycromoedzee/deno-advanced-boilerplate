// Fixture for the no-static-custom-http-error-message rule.
// The DYNAMIC case is ALLOWED (template literal with ${} interpolation).
// The two STATIC cases must be FLAGGED.
import { throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";

declare const id: string;

// DYNAMIC — allowed
throwHttpErrorWithCustomMessage("COMMON.NOT_FOUND", `Resource not found: ${id}`);

// STATIC — must be flagged (string literal)
throwHttpErrorWithCustomMessage("COMMON.BAD_REQUEST", "Tags must be an array");

// STATIC — must be flagged (template literal with zero expressions)
throwHttpErrorWithCustomMessage("COMMON.BAD_REQUEST", `No thumbnail data provided`);
