# Constants Directory

This directory contains centralized constants and configuration values used throughout the moedzee-be application.

## Directory Structure

```
constants/
├── validation/
│   ├── index.ts                    # Main export
│   ├── string-lengths.ts           # String length constraints
│   ├── numeric-limits.ts           # Numeric constraints
│   ├── permissions.ts              # Permission level constraints
│   └── regex-patterns.ts           # Regex patterns
├── documents/
│   ├── index.ts                    # Main export
│   ├── file-upload.ts              # File upload constraints
│   └── bulk-operations.ts          # Bulk operation limits
├── pagination.ts                   # Pagination defaults
├── ui.ts                          # UI-related constants (colors, icons)
└── auth.ts                        # Authentication constraints
```

## Usage

### Importing Constants

```typescript
// Import specific constants
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { BULK_OPERATION_CONSTRAINTS } from "@constants/documents/bulk-operations.ts";
import { PAGINATION_DEFAULTS } from "@constants/pagination.ts";

// Or use barrel exports
import { NUMERIC_LIMITS, STRING_LENGTH_CONSTRAINTS } from "@constants/validation";
```

### Example Usage in Zod Schemas

```typescript
export const SchemaTagCreateRequest = z.object({
  name: z.string()
    .min(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MIN)
    .max(STRING_LENGTH_CONSTRAINTS.TAG_NAME_MAX),
  color: z.string().regex(REGEX_PATTERNS.HEX_COLOR),
  description: z.string()
    .max(STRING_LENGTH_CONSTRAINTS.DESCRIPTION_SHORT_MAX)
    .optional(),
});
```

## Available Constants

### Validation Constants

- **STRING_LENGTH_CONSTRAINTS**: Name lengths, descriptions, content limits
- **NUMERIC_LIMITS**: Array sizes, file limits, folder constraints
- **PERMISSION_CONSTRAINTS**: Permission level ranges and defaults
- **REGEX_PATTERNS**: Hex colors, MIME types, UUIDs

### Document Constants

- **FILE_UPLOAD_CONSTRAINTS**: File size limits, MIME types
- **BULK_OPERATION_CONSTRAINTS**: Bulk operation limits

### Other Constants

- **PAGINATION_DEFAULTS**: Page, limit, sort defaults
- **UI_DEFAULTS**: Color and icon defaults
- **PASSWORD_CONSTRAINTS**: User and share password requirements

## Migration Notes

Many constants were previously duplicated across model files. They have been centralized here to:

1. Eliminate duplication
2. Provide a single source of truth
3. Enable easier maintenance and updates
4. Improve type safety and consistency

Old exports in `models/documents/validation.schemas.ts` are deprecated but maintained for backward compatibility.

## Adding New Constants

When adding new constants:

1. Determine the appropriate category
2. Add the constant with proper TypeScript types
3. Export from the appropriate barrel file
4. Document the constant with JSDoc comments
5. Update this README if adding new categories

## Best Practices

- **Use constants instead of magic numbers**: `MAX_TAGS_PER_DOCUMENT` instead of `20`
- **Import from specific files**: Better for tree-shaking
- **Use descriptive names**: `NAME_MAX` not `MAX_NAME`
- **Keep related constants together**: All string lengths in one file
- **Document usage**: Add examples in JSDoc comments

## Backward Compatibility

Some constants are exported from old locations for backward compatibility but marked as deprecated:

```typescript
/**
 * @deprecated Use STRING_LENGTH_CONSTRAINTS from @constants/validation instead
 */
export const OLD_CONSTANT = ...;
```

These deprecated exports will be removed in a future major version.
