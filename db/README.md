# PostgreSQL JSONB Operations

Comprehensive utilities for working with JSONB columns in PostgreSQL using Drizzle ORM. Provides both a powerful JSONPath API and practical
helper functions for all your JSON querying needs.

## 🚀 Quick Start

```typescript
import { getDB } from "./db/db.ts";
import { and, eq } from "drizzle-orm";
import { apiKeys, threatIPs, users } from "./db/schema/index.ts";
import { arrayContains, extractText } from "./db/json-operations.ts";

const db = getDB();

// JSONPath API - Perfect for nested queries
const engineers = await db
  .select()
  .from(users)
  .where(db.json(users.metadata).equals("$.department", "engineering"));

// arrayContains - Works perfectly with jsonStringArray columns
const reactDevelopers = await db
  .select()
  .from(users)
  .where(arrayContains(users.skills, "React")); // users.skills is jsonStringArray

// extractText - Get string values from JSON metadata
const userCountries = await db
  .select({
    id: users.id,
    country: extractText(users.metadata, "country"),
  })
  .from(users);
```

## 🎯 **Main JSONPath API** (`db.json(column)`)

### **Querying & Filtering Operations**

| Method                 | Description                     | Example                                                             | Use Case                     |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------- | ---------------------------- |
| `equals(path, value)`  | Value at JSONPath equals        | `db.json(users.metadata).equals('$.department', 'engineering')`     | Exact nested value matching  |
| `contains(object)`     | JSON contains object properties | `db.json(users.metadata).contains({ role: 'admin', active: true })` | Multiple property matching   |
| `exists(path)`         | JSONPath exists                 | `db.json(users.metadata).exists('$.preferences')`                   | Check if nested field exists |
| `arrayContains(value)` | Array contains value            | `db.json(users.metadata).arrayContains('React')`                    | Value in JSON array          |
| `isEmpty()`            | JSON is null/empty              | `db.json(users.metadata).isEmpty()`                                 | Filter out empty records     |

### **Extracting & Selecting Operations**

| Method          | Description            | Example                                           | Use Case                         |
| --------------- | ---------------------- | ------------------------------------------------- | -------------------------------- |
| `extract(path)` | Extract value as JSONB | `db.json(users.metadata).extract('$.department')` | Get nested objects/values        |
| `length()`      | Array/object length    | `db.json(users.metadata).length()`                | Count array items or object keys |
| `keys()`        | Get object keys        | `db.json(users.metadata).keys()`                  | List all keys in JSON object     |

## 🔧 **Essential Helper Functions** (Only 2!)

| Function                  | Description          | Example                                  | Use Case                              |
| ------------------------- | -------------------- | ---------------------------------------- | ------------------------------------- |
| `arrayContains(col, val)` | Array contains value | `arrayContains(users.skills, 'React')`   | Perfect for `jsonStringArray` columns |
| `extractText(col, path)`  | Extract as text      | `extractText(users.metadata, 'country')` | Get string values in SELECT           |

**That's it!** The JSONPath API handles everything else.

## 🎯 **Perfect `jsonStringArray` Integration**

The `arrayContains` helper is designed specifically for your `jsonStringArray` custom type:

```typescript
import { dbTable, jsonStringArray, text } from "./db/entities.ts";

// Schema with jsonStringArray columns
export const users = dbTable("users", {
  id: text("id").primaryKey(),
  skills: jsonStringArray("skills").default([]), // ["React", "TypeScript", "Node.js"]
  tags: jsonStringArray("tags").default([]), // ["frontend", "senior", "remote"]
  languages: jsonStringArray("languages").default([]), // ["en", "es", "fr"]
});

// arrayContains works perfectly with these columns
const reactDevelopers = await db
  .select()
  .from(users)
  .where(arrayContains(users.skills, "React"));

const seniorFrontendDevs = await db
  .select()
  .from(users)
  .where(
    and(
      arrayContains(users.skills, "React"),
      arrayContains(users.tags, "senior"),
      arrayContains(users.tags, "frontend"),
    ),
  );

// JSONPath API also works with jsonStringArray
const skillfulDevelopers = await db
  .select({
    id: users.id,
    skillCount: db.json(users.skills).length(),
    hasReact: db.json(users.skills).arrayContains("React"),
    isEmpty: db.json(users.skills).isEmpty(),
  })
  .from(users);
```

### **Why It Works:**

- `jsonStringArray` creates **JSONB columns** in PostgreSQL
- `arrayContains` uses PostgreSQL's native **`?` operator** for JSONB arrays
- **Perfect compatibility** - no conversion needed! 🎯

## 🚀 **Real-World Examples**

### **1. User Skills & Tags (jsonStringArray + JSONPath)**

```typescript
// Schema: users.skills (jsonStringArray), users.tags (jsonStringArray), users.metadata (jsonb)

// Find React developers with senior level
const seniorReactEngineers = await db
  .select()
  .from(users)
  .where(
    and(
      eq(users.isActive, true),
      arrayContains(users.skills, "React"), // jsonStringArray helper
      arrayContains(users.tags, "senior"), // jsonStringArray helper
      db.json(users.metadata).equals("$.department", "engineering"), // JSONPath for metadata
    ),
  );

// Complex skill requirements
const fullStackDevelopers = await db
  .select()
  .from(users)
  .where(
    and(
      arrayContains(users.skills, "React"),
      arrayContains(users.skills, "Node.js"),
      arrayContains(users.skills, "PostgreSQL"),
      db.json(users.skills).length() >= 5, // JSONPath API works too!
    ),
  );

// Extract user profiles with skill analysis
const userProfiles = await db
  .select({
    id: users.id,
    name: users.firstName,
    skillCount: db.json(users.skills).length(), // JSONPath API
    department: extractText(users.metadata, "department"), // extractText helper
    isFullStack: sql<boolean>`${users.skills} ? 'React' AND ${users.skills} ? 'Node.js'`,
  })
  .from(users)
  .where(db.json(users.skills).isEmpty().not()); // Has skills
```

### **2. API Key Security (Simplified)**

```typescript
import { arrayContains } from "./db/json-operations.ts";

// Validate API key against IP restrictions
const isValidKey = await db
  .select()
  .from(apiKeys)
  .where(
    and(
      eq(apiKeys.isActive, true),
      arrayContains(apiKeys.ipRestrictions, clientIP),
      arrayContains(apiKeys.domainRestrictions, clientDomain),
    ),
  )
  .limit(1);

// Get API key statistics using JSONPath API
const keyStats = await db
  .select({
    id: apiKeys.id,
    name: apiKeys.name,
    ipCount: db.json(apiKeys.ipRestrictions).length(),
    domainCount: db.json(apiKeys.domainRestrictions).length(),
    hasRestrictions: sql<boolean>`${apiKeys.ipRestrictions} IS NOT NULL`,
  })
  .from(apiKeys);
```

### **3. Threat Intelligence Analysis (Simplified)**

```typescript
import { extractText } from "./db/json-operations.ts";

// Metadata: { country: 'CN', asn: 'AS4134', reasons: ['malware', 'botnet'], confidence: 95 }

// Find high-risk threats from specific countries - all JSONPath API
const highRiskThreats = await db
  .select()
  .from(threatIPs)
  .where(
    and(
      db.json(threatIPs.metadata).equals("$.country", "CN"),
      sql`${db.json(threatIPs.metadata).extract("$.confidence")}::int > 90`,
      db.json(threatIPs.metadata).arrayContains("malware"),
    ),
  );

// Extract threat details for reporting
const threatReport = await db
  .select({
    ip: threatIPs.ipAddress,
    country: extractText(threatIPs.metadata, "country"), // Only helper needed
    asn: extractText(threatIPs.metadata, "asn"),
    reasons: db.json(threatIPs.metadata).extract("$.reasons"),
    riskScore: threatIPs.riskScore,
  })
  .from(threatIPs)
  .where(
    and(
      eq(threatIPs.isActive, true),
      db.json(threatIPs.metadata).contains({ country: "CN" }), // JSONPath API
    ),
  );
```

### **4. Job Queue & Email Processing**

```typescript
// Job data: { type: 'email', template: 'welcome', userId: '123', priority: 'high' }

// Find high-priority email jobs
const urgentEmails = await db
  .select()
  .from(jobs)
  .where(
    and(
      db.json(jobs.data).contains({ type: "email", priority: "high" }),
      eq(jobs.status, "pending"),
    ),
  );

// Get job statistics by type
const jobStats = await db
  .select({
    type: extractText(jobs.data, "type"), // Simple helper
    count: sql<number>`count(*)`,
    avgAttempts: sql<number>`avg(${jobs.attempts})`,
  })
  .from(jobs)
  .where(db.json(jobs.data).exists("$.type")) // JSONPath API
  .groupBy(extractText(jobs.data, "type"));
```

## 🎯 **When to Use Which Approach**

### **Use JSONPath API (`db.json()`) When:**

- ✅ **Deep nesting**: `$.user.profile.department.team`
- ✅ **Complex path queries**: Multiple nested levels
- ✅ **Exact path matching**: Need specific nested value
- ✅ **Path existence checks**: Verify nested structure exists
- ✅ **Dynamic paths**: Building paths programmatically

```typescript
// Perfect for JSONPath API
db.json(users.metadata).equals("$.department.team.role", "lead");
db.json(users.metadata).exists("$.preferences.notifications.email");
```

### **Use Helper Functions When:**

- ✅ **Array membership**: `arrayContains(column, value)` - Perfect for `jsonStringArray` columns
- ✅ **Text extraction**: `extractText(column, path)` - Get strings from JSON metadata

```typescript
// Only 2 helpers needed!
arrayContains(users.skills, "React"); // jsonStringArray column
extractText(users.metadata, "country"); // JSON metadata column
```

### **Mix Both Approaches:**

```typescript
// Combine for powerful queries
const complexQuery = await db
  .select()
  .from(users)
  .where(
    and(
      // JSONPath for nested structure
      db.json(users.metadata).equals("$.department.team", "backend"),
      // JSONPath for containment too
      db.json(users.metadata).contains({ active: true }),
      // Standard Drizzle for regular columns
      eq(users.isActive, true),
    ),
  );
```

## 🔧 **Best Practices**

### **Performance Tips:**

1. **Index JSONB columns** for better query performance
2. **Use helper functions** for simple operations (faster)
3. **Combine with regular indexes** on non-JSON columns
4. **Extract frequently queried paths** to separate columns if needed

### **Type Safety:**

```typescript
// Use typed interfaces for better development experience
interface UserMetadata {
  department: string;
  level: "junior" | "senior" | "lead";
  skills: string[];
  preferences?: {
    notifications: boolean;
    theme: "light" | "dark";
  };
}

// Type-safe queries
const typedQuery = db.json<UserMetadata>(users.metadata)
  .equals("$.department", "engineering");
```

### **Error Handling:**

```typescript
// JSONPath validation
try {
  const result = db.json(users.metadata).equals("$.invalid.path", "value");
} catch (error) {
  // Handle invalid JSONPath syntax
  console.error("Invalid JSONPath:", error.message);
}
```

## 📊 **Schema Usage Examples**

## 📋 **Recommended Schema Pattern**

```typescript
import { dbTable, json, jsonStringArray, text } from "./db/entities.ts";

// Recommended: Use jsonStringArray for string arrays, json for complex data
export const users = dbTable("users", {
  id: text("id").primaryKey(),

  // jsonStringArray - Perfect for simple string arrays
  skills: jsonStringArray("skills").default([]), // ["React", "TypeScript"]
  tags: jsonStringArray("tags").default([]), // ["senior", "frontend"]
  languages: jsonStringArray("languages").default([]), // ["en", "es"]

  // json - For complex nested objects
  metadata: json("metadata").default({}), // { department: "eng", level: "senior" }
  preferences: json("preferences").default({}), // { theme: "dark", notifications: true }
});

export const apiKeys = dbTable("api_keys", {
  id: text("id").primaryKey(),

  // jsonStringArray for IP/domain restrictions
  ipRestrictions: jsonStringArray("ip_restrictions").default([]),
  domainRestrictions: jsonStringArray("domain_restrictions").default([]),
});
```

## 📚 **Import Guide**

```typescript
// Main JSONPath API (always available on db instance)
import { getDB } from "./db/db.ts";
const db = getDB();
// Use: db.json(column).equals(), db.json(column).contains(), etc.

// Only 2 helper functions (import as needed)
import { arrayContains, extractText } from "./db/json-operations.ts";

// Type definitions (only if you need the JsonOperations interface)
import type { JsonOperations } from "./db/json-operations.ts";
```

## 🎯 **Summary**

### **Available Operations:**

- **8 JSONPath methods** for complex nested queries (`db.json()`)
- **2 essential helpers** for common patterns (`arrayContains`, `extractText`)
- **Full TypeScript support** with proper interfaces

### **Key Benefits:**

- 🚀 **Powerful**: Handle any level of JSON nesting
- ⚡ **Fast**: Uses native PostgreSQL JSONB operators
- 🔒 **Type-safe**: Full TypeScript integration
- 🎯 **Flexible**: Choose the right tool for each query
- 📖 **Well-documented**: Comprehensive examples and use cases

### **Perfect For:**

- User preferences and settings
- API key restrictions and validation
- Threat intelligence metadata
- Job queue data processing
- Any complex JSON data structures

**Ready to query your JSONB data like a pro!** 🎉
