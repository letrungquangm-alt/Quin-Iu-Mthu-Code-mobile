---
name: directus-database
description: >-
  Comprehensive Headless CMS, Database & Data API skill for Directus.
  Use when designing database schemas, managing collections and fields, querying REST or GraphQL APIs,
  configuring RBAC permissions, building custom Directus Flows or extensions, or integrating @directus/sdk.
version: 1.0.0
---

# Directus Database & Headless CMS Skill

Directus wraps any SQL database (PostgreSQL, MySQL, SQLite, MSSQL, CockroachDB, MariaDB) with instant, real-time REST and GraphQL APIs, an intuitive Admin panel, Granular Role-Based Access Control (RBAC), and automation Flows.

---

## 1. Quick Integration with `@directus/sdk` (v11+)

Install:
```bash
npm install @directus/sdk
```

Initialize Client:
```typescript
import { createDirectus, rest, authentication, readItems, createItem, updateItem, deleteItem } from '@directus/sdk';

// Define schema types for TypeScript autocomplete
interface Schema {
  users_profiles: UserProfile[];
  projects: Project[];
  tasks: Task[];
}

interface Project {
  id: number;
  name: string;
  status: 'draft' | 'active' | 'archived';
  owner_id: string;
  created_at: string;
}

const directus = createDirectus<Schema>('https://your-directus-instance.com')
  .with(authentication('json'))
  .with(rest());

// Authenticate
await directus.login('user@example.com', 'secure_password');
```

---

## 2. Advanced Query Operators & CRUD

### Query Filter Syntax
Directus supports intuitive nested filter objects:
- `_eq` (equals), `_neq` (not equals)
- `_in` (in array), `_nin` (not in array)
- `_contains` (case-insensitive substring), `_starts_with`, `_ends_with`
- `_gt`, `_gte`, `_lt`, `_lte`, `_between`
- `_null`, `_nnull`
- Logical groups: `_and`, `_or`

### Practical Query Examples

```typescript
// 1. Fetch filtered and sorted items with relational fields
const activeProjects = await directus.request(
  readItems('projects', {
    filter: {
      status: { _eq: 'active' },
      created_at: { _gte: '$NOW(-30 days)' }
    },
    sort: ['-created_at'],
    limit: 10,
    fields: ['id', 'name', 'status', { owner_id: ['id', 'first_name', 'email'] }]
  })
);

// 2. Create a new item
const newProject = await directus.request(
  createItem('projects', {
    name: 'QuinloveRin Remote Hub',
    status: 'active'
  })
);

// 3. Update an existing item
await directus.request(
  updateItem('projects', newProject.id, {
    status: 'archived'
  })
);

// 4. Delete an item
await directus.request(deleteItem('projects', newProject.id));
```

---

## 3. Directus Schema Management via API

You can programmatically create tables (collections) and columns (fields):

### Create Collection (Table)
```typescript
import { createCollection, createField } from '@directus/sdk';

await directus.request(
  createCollection({
    collection: 'orders',
    meta: {
      note: 'Quản lý đơn hàng thương mại điện tử',
      icon: 'shopping_cart'
    },
    schema: {} // uses default database engine
  })
);

// Add field to 'orders'
await directus.request(
  createField('orders', {
    field: 'total_amount',
    type: 'decimal',
    schema: {
      numeric_precision: 10,
      numeric_scale: 2
    },
    meta: {
      interface: 'input',
      required: true,
      options: { iconRight: 'attach_money' }
    }
  })
);
```

---

## 4. Directus Authentication & Static Tokens

For server-to-server or background bot automation (like our Telegram Bot):
1. Create a Service User in Directus Admin with a custom Role.
2. Generate a **Static Token** in the user's profile.
3. Use the static token with `@directus/sdk` or raw HTTP:

```typescript
import { createDirectus, rest, staticToken } from '@directus/sdk';

const client = createDirectus('https://api.example.com')
  .with(staticToken('YOUR_DIRECTUS_STATIC_TOKEN'))
  .with(rest());
```

Header for raw HTTP / curl:
```http
Authorization: Bearer YOUR_DIRECTUS_STATIC_TOKEN
```

---

## 5. Directus Flows (Automations & Webhooks)

Directus Flows enable event-driven logic directly inside the database engine:
- **Triggers**:
  - `Event Hook` (e.g. `items.create`, `items.update` in `orders` collection)
  - `Webhook` (Incoming HTTP POST with secret key)
  - `Schedule` (Cron expression)
- **Operations**:
  - `Run Script` (Sandboxed JavaScript)
  - `Send Webhook / HTTP Request` (Notify Telegram Bot or external APIs)
  - `Transform Data`
  - `Condition` (Branching IF/ELSE)
