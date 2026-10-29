# DocuVault - Versioned Wiki & Documentation Engine (MongoDB + Express + Node.js)

A production-ready, fully functional versioned wiki and documentation system built with **Node.js**, **Express**, and **Mongoose (MongoDB)**. It features strict auditability, dual-collection historical version isolation, compound-indexed revision queries, rollbacks without data loss, soft deletes, and a modern responsive interactive web UI.

---

## Table of Contents
1. [Core Architecture & Concept](#core-architecture--concept)
2. [Data Model & Schema](#data-model--schema)
3. [Schema Design Rationale: Separate Revisions vs. Embedded Array](#schema-design-rationale-separate-revisions-vs-embedded-array)
4. [Index Choice & Optimization](#index-choice--optimization)
5. [Rollback Logic & Audit Trail](#rollback-logic--audit-trail)
6. [Explain Plan & ExecutionStats Output](#explain-plan--executionstats-output)
7. [Getting Started & Installation](#getting-started--installation)
8. [Interactive Web Frontend](#interactive-web-frontend)
9. [REST API Documentation & cURL Examples](#rest-api-documentation--curl-examples)
10. [Test Suite](#test-suite)

---

## Core Architecture & Concept

Users can create documentation pages, update content, view the complete historical timeline of edits, inspect any past revision snapshot, and roll back to prior versions.

- **Immutable Revisions**: Every edit preserves the pre-update state as an immutable revision before modifying the live record.
- **Auditable Rollbacks**: Rolling back does not erase history; the pre-rollback state is archived as a new revision, and the document advances to a higher version number containing the restored content.
- **Standalone MongoDB Compatible**: Operates safely on standalone MongoDB instances without requiring replica set transactions by enforcing strict sequential write ordering (archive revision first $\rightarrow$ update live document).

---

## Data Model & Schema

The system uses **two decoupled collections**:

### 1. `pages` (Current Live State)
Represents the current, canonical version of each documentation page.

| Field | Type | Attributes | Description |
|---|---|---|---|
| `_id` | ObjectId | Auto-generated | Primary key |
| `slug` | String | Unique, Indexed, Kebab-case | Human-readable URL identifier (e.g. `architecture-overview`) |
| `title` | String | Required, Trimmed | Document title |
| `content` | String | Required | Current live markdown body |
| `currentVersion` | Number | Default: `1`, Min: `1` | Monotonically increasing live version counter |
| `status` | String | Enum: `['active', 'archived']`, Indexed | Soft-deletion flag (default: `'active'`) |
| `createdAt` | Date | Managed by timestamps | Creation timestamp |
| `updatedAt` | Date | Managed by timestamps | Last update timestamp |

### 2. `page_revisions` (Historical Audit Trail)
Stores point-in-time snapshots of past document versions.

| Field | Type | Attributes | Description |
|---|---|---|---|
| `_id` | ObjectId | Auto-generated | Primary key |
| `pageId` | ObjectId | Ref: `'Page'`, Required, Indexed | Foreign reference to `pages._id` |
| `version` | Number | Required, Min: `1` | Historical version number |
| `title` | String | Required, Trimmed | Title at that revision |
| `content` | String | Required | Markdown body at that revision |
| `archivedAt` | Date | Default: `Date.now` | Exact timestamp when this revision was archived |
| `changedBy` | String | Optional, Trimmed | Author or audit reason for the revision |

---

## Schema Design Rationale: Separate Revisions vs. Embedded Array

Why use two separate collections instead of embedding a `revisions: [...]` array directly inside the `pages` document?

1. **MongoDB 16 MB Document Size Limit (BSON Hard Limit)**:
   Documentation pages often contain thousands of words, code blocks, or diagrams. If revisions were embedded as subdocuments inside `pages`, a frequently updated page would steadily grow and eventually hit MongoDB's 16 MB document size limit (`BSONObjectTooLarge`), permanently corrupting the ability to save new edits.
2. **Preventing Memory Fragmentation and Document Relocation**:
   In WiredTiger, repeatedly appending items to an embedded array causes documents to outgrow their pre-allocated disk space. This triggers document movement, storage fragmentation, and increased I/O write amplification. Separate collections guarantee that historical revisions are written once (insert-only) and never resized.
3. **Optimized Read Performance for Live Documentation**:
   In a wiki, **95%+ of queries request only the current live page**. Embedding 100 past revisions into the live document forces MongoDB to read megabytes of historical data into the WiredTiger cache and transfer it over the network just to display the latest page. With separate collections, `pages` stays lean and cache-friendly.
4. **Independent Indexing & Compound Sorting**:
   Revisions require specific sorting (`version: -1`) and filtering (`pageId + version`). Storing revisions in a dedicated collection allows MongoDB to leverage specialized compound B-tree indexes (`{ pageId: 1, version: -1 }`) without in-memory array manipulation or unwind stages.

---

## Index Choice & Optimization

### Compound Index: `{ pageId: 1, version: -1 }` on `page_revisions`

This specific compound index satisfies the **Equality-Sort-Range (ESR)** design principle:

1. **Revision History Query**:
   ```javascript
   db.page_revisions.find({ pageId: page._id }).sort({ version: -1 })
   ```
   - **Equality Stage**: Matches `pageId` exact value using index prefix.
   - **Sort Stage**: The index B-tree naturally stores versions in descending order (`-1`). MongoDB traverses the index in forward direction and fetches documents directly in pre-sorted order **without an in-memory `SORT` stage**.
2. **Point Version Lookup Query**:
   ```javascript
   db.page_revisions.findOne({ pageId: page._id, version: targetVersion })
   ```
   - Both `pageId` and `version` are covered by the index. The database performs an immediate point lookup (`IXSCAN`) examining exactly 1 key and 1 document (`totalKeysExamined: 1, totalDocsExamined: 1`).

---

## Rollback Logic & Audit Trail

When rolling back to a previous version (e.g., rolling back from live version `v3` to past version `v1`):

```
State Before Rollback:
  pages: { slug: 'doc', currentVersion: 3, content: 'Version 3 live content' }
  page_revisions: [ v1, v2 ]

Rollback Execution:
  Step 1. Fetch snapshot of target revision v1 using { pageId, version: 1 }.
  Step 2. Archive current live state (v3) as a new revision record in page_revisions:
          { pageId, version: 3, content: 'Version 3 live content', changedBy: 'Rollback to v1' }
  Step 3. Overwrite live page with v1 content and increment currentVersion:
          { currentVersion: 4, content: 'Version 1 content' }

State After Rollback:
  pages: { slug: 'doc', currentVersion: 4, content: 'Version 1 content' }
  page_revisions: [ v1, v2, v3 ]
```

### Why This Is Strictly Auditable
- **Zero History Loss**: Version 3 is preserved forever in `page_revisions`.
- **Chronological Integrity**: The live page moves forward to `v4`. It does not delete or rewind version numbers. Any team member can review the audit log and see:
  - Version 1 was active.
  - Version 2 was updated.
  - Version 3 was updated.
  - Version 4 was deployed as a rollback restoring the content of Version 1.

---

## Explain Plan & ExecutionStats Output

Running `.explain("executionStats")` confirms that revision lookups utilize the compound index without an in-memory sort:

```text
================================================================
 MongoDB .explain("executionStats") Analysis for Revision Lookups
================================================================
[MongoDB] Connected successfully to host: localhost, database: versioned_wiki_db
Analyzing query execution for page: "System Architecture & Data Flow" (architecture-overview)

[1] Confirmed Existing Indexes on `page_revisions`:
[
  { v: 2, key: { _id: 1 }, name: '_id_' },
  { v: 2, key: { pageId: 1 }, name: 'pageId_1', background: true },
  {
    v: 2,
    key: { pageId: 1, version: -1 },
    name: 'pageId_1_version_-1',
    background: true
  }
]

----------------------------------------------------------------
[2] Running .explain("executionStats") on Revision History Query:
    Query: db.page_revisions.find({ pageId: ObjectId(...) }).sort({ version: -1 })

>>> Winning Plan Stage Structure:
┌─────────┬──────────┬───────────────────────┬───────────┐
│ (index) │ stage    │ indexName             │ direction │
├─────────┼──────────┼───────────────────────┼───────────┤
│ 0       │ 'FETCH'  │ 'pageId_1_version_-1' │ 'forward' │
│ 1       │ 'IXSCAN' │ 'pageId_1_version_-1' │ 'forward' │
└─────────┴──────────┴───────────────────────┴───────────┘

>>> Execution Stats Summary:
- Execution Success:              true
- Documents Returned (nReturned): 3
- Total Keys Examined:             3
- Total Docs Examined:             3
- Execution Time (ms):             1 ms
- Index Used:                      pageId_1_version_-1
- In-Memory SORT required?:        NO (Index provides sorted order)

----------------------------------------------------------------
[3] Running .explain("executionStats") on Single Version Query:
    Query: db.page_revisions.findOne({ pageId: ObjectId(...), version: 1 })

>>> Execution Stats Summary:
- Execution Success:              true
- Documents Returned (nReturned): 1
- Total Keys Examined:             1
- Total Docs Examined:             1
- Execution Time (ms):             1 ms
- Compound Index Point Lookup:     Confirmed IXSCAN on pageId_1_version_-1
```

You can re-run this at any time with:
```bash
npm run explain
```
Or inspect it directly through the UI or API endpoint:
```bash
curl http://localhost:3000/api/pages/architecture-overview/revisions/explain
```

---

## Getting Started & Installation

### Prerequisites
- **Node.js**: v18+ (tested on v26 LTS)
- **MongoDB**: Standalone or Atlas (tested on MongoDB 9.0 Community Server)

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd "MongoDB project"
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration:
```ini
PORT=3000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/versioned_wiki_db
```

### 3. Seed Database
Insert 3 sample pages with multiple historical revisions:
```bash
npm run seed
```

### 4. Start the Application
```bash
npm start
```
The server will start at:
- **Web UI**: [http://localhost:3000](http://localhost:3000)
- **API Base**: [http://localhost:3000/api/pages](http://localhost:3000/api/pages)

---

## Interactive Web Frontend

Open [http://localhost:3000](http://localhost:3000) in your browser:
- **Live Sidebar**: Search and filter pages by title/slug, switch between Active and Archived pages.
- **Markdown Documentation Viewer**: Formatted headings, code syntax, quotes, and badges.
- **New Page Modal**: Auto-generates URL slugs from the title, validates input in real-time.
- **Edit Modal**: Displays the upcoming version number and archives previous state upon saving.
- **History Timeline**: Chronological visual feed showing each version, timestamp, and author.
- **Snapshot Viewer**: Inspect any past version with a one-click "Rollback to this Version" action.
- **Explain Inspector**: Visual dashboard showing MongoDB's index stats and winning plan.
- **Soft Delete & Restore**: Archive a page to remove it from the active list, or restore it at any time.

---

## REST API Documentation & cURL Examples

### 1. Create Page
- **Method**: `POST /api/pages`
- **Description**: Creates a new page document at `currentVersion: 1`. No revision is created yet.

```bash
curl -X POST http://localhost:3000/api/pages \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Authentication Guide",
    "slug": "auth-guide",
    "content": "# Authentication\n\nWe use JWT tokens for stateless API sessions.",
    "changedBy": "Alice Developer"
  }'
```

### 2. List Active Pages
- **Method**: `GET /api/pages`
- **Description**: Returns all active pages (excludes archived), sorted by `updatedAt` descending.

```bash
curl -X GET http://localhost:3000/api/pages
```
To include archived pages:
```bash
curl -X GET "http://localhost:3000/api/pages?includeArchived=true"
```

### 3. Get Live Page by Slug
- **Method**: `GET /api/pages/:slug`
- **Description**: Returns the current live document.

```bash
curl -X GET http://localhost:3000/api/pages/auth-guide
```

### 4. Edit Page (Order-Preserved Revision Write)
- **Method**: `PUT /api/pages/:slug`
- **Description**: Archives current state into `page_revisions` first, updates live page, and increments `currentVersion`.

```bash
curl -X PUT http://localhost:3000/api/pages/auth-guide \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Authentication & OAuth Guide",
    "content": "# Authentication & OAuth\n\nAdded Google and GitHub OAuth providers.",
    "changedBy": "Bob Lead"
  }'
```

### 5. Get Revision History
- **Method**: `GET /api/pages/:slug/revisions`
- **Description**: Returns all revisions for the page, sorted by `version: -1` using the compound index.

```bash
curl -X GET http://localhost:3000/api/pages/auth-guide/revisions
```

### 6. Get Specific Historical Version
- **Method**: `GET /api/pages/:slug/revisions/:version`
- **Description**: Fetches an exact revision snapshot using compound index lookup (`{ pageId, version }`).

```bash
curl -X GET http://localhost:3000/api/pages/auth-guide/revisions/1
```

### 7. Rollback to Past Version
- **Method**: `POST /api/pages/:slug/rollback/:version`
- **Description**: Archives the current live state as a new revision, restores the past version's content, and increments `currentVersion`.

```bash
curl -X POST http://localhost:3000/api/pages/auth-guide/rollback/1 \
  -H "Content-Type: application/json" \
  -d '{
    "changedBy": "Rollback Admin: Reverted OAuth experiment"
  }'
```

### 8. Soft Delete / Archive Page
- **Method**: `DELETE /api/pages/:slug`
- **Description**: Sets `status: 'archived'`. Page will no longer appear in default list endpoint.

```bash
curl -X DELETE http://localhost:3000/api/pages/auth-guide
```

### 9. Restore Archived Page
- **Method**: `PATCH /api/pages/:slug/restore`
- **Description**: Sets `status: 'active'`.

```bash
curl -X PATCH http://localhost:3000/api/pages/auth-guide/restore
```

### 10. Explain Query Plan Inspector
- **Method**: `GET /api/pages/:slug/revisions/explain`
- **Description**: Returns executionStats from MongoDB showing compound index `pageId_1_version_-1` utilization.

```bash
curl -X GET http://localhost:3000/api/pages/architecture-overview/revisions/explain
```

---

## Test Suite

The project includes an automated end-to-end integration test suite verifying all 12 operational behaviors:

```bash
npm test
```

### What is tested:
1. Database seeding & reset
2. Active pages listing and sort order
3. Input validation errors (title, content, slug regex)
4. New page creation with `currentVersion: 1` and 0 revisions
5. Slug collision prevention (`409 Conflict`)
6. Sequential edits, version advancement, and revision archiving
7. Revision history descending sort order
8. Single version query via compound index
9. Auditable rollback preserving pre-rollback state
10. Soft delete / archive excluding page from active list
11. Soft delete restoration
12. Compound index explain stats verification

