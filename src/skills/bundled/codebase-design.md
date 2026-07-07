---
name: codebase-design
description: Map the current architecture before changing it.
---

# Codebase Design

When you enter a codebase for the first time, you don't have a mental model of its architecture. This is a series of passes to build one.

## Pass 1: Explore

Run the search commands against the codebase:

```
docs/agents/
.docs/
docs/
```

Then, ask the user for the test running command.

When returning results, format them in the following way:

```
File

[file contents]
```

## Pass 2: Write a `CONTEXT.md`

Write a `CONTEXT.md` to the root of the project, containing:

- The project's high-level purpose
- The architectural style (monolith, microservices, event-driven, layered, hexagonal — if multiple, say which parts use which)
- The directory structure with explanation of each top-level directory
- Key data models, if any
- A data flow summary — how does a request flow through the system?
- Key patterns used in the codebase
- Testing strategy
- How logging and error handling work
- How configuration works
- How deployment works
- Documentation and on-call
- Any notable quirks or sharp edges (including build scripts that must be run in a certain order, debug commands, or footguns)
- The location of any other `CONTEXT.md` files

## Pass 3: Deepen (optional)

If the user wants to go deeper, run the `/deepen` command.

## Pass 4: Design

When designing a new feature, describe the design for each component of the change in a structured way.

Ask the user to confirm each step before moving on.

### Step 1: Model the data

```
## Data Model

### New Types

type InvoiceStatus = "pending" | "paid" | "overdue" | "cancelled"

### New / Changed Database Tables

**invoices**
| Column | Type | Notes |
|--------|------|-------|
| id | string | Primary key |
| subscription_id | string | FK to subscriptions |
| amount_due | number | In cents |
| status | InvoiceStatus | |
| due_date | string | ISO 8601 |
| paid_at | string | Nullable |

### New / Changed API DTOs

**POST /api/subscriptions/:id/invoice**
{
  subscriptionId: string;
  amountDue: number;
  dueDate: string;
}

**GET /api/invoices/:id**
{
  id: string;
  subscriptionId: string;
  amountDue: number;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
}
```

### Step 2: Define the API

```
## API Design

### POST /api/subscriptions/:id/invoice
- Action: Creates an invoice for a subscription
- Auth: Requires admin or subscription owner
- Validation: subscription must be active, amount_due > 0
- Response: 201 with invoice object
- Errors: 400 if subscription is not active, 404 if subscription not found
```

### Step 3: Define the flow

```
## Application Flow

1. User calls POST /api/subscriptions/:id/invoice
2. Auth middleware checks user is admin or owner
3. Route handler calls createInvoice(subscriptionId, amountDue)
4. createInvoice checks subscription is active
5. createInvoice calculates due_date (now + 30 days)
6. createInvoice inserts into database
7. Route handler returns 201 with invoice object
```

### Step 4: Define components & hooks (front-end only)

```
## Components & Hooks

### useInvoice
- Returns createInvoice mutation, current invoice data, loading/error states

### InvoicePage
- Uses useInvoice to fetch invoice data
- Displays invoice details
- Calls createInvoice to create new invoices

### InvoiceList
- Uses useInvoice to fetch list of invoices
- Displays list of invoices
- Links to InvoicePage for each invoice
```

## Pass 5: Implement

Implement the change, component by component.
