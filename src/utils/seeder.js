const Page = require('../models/Page');
const PageRevision = require('../models/PageRevision');

async function seedWikiData() {
  // Clear existing wiki data
  await Page.deleteMany({});
  await PageRevision.deleteMany({});

  // Ensure compound index is created
  await PageRevision.syncIndexes();
  await Page.syncIndexes();

  // 1. Architecture Overview (3 past revisions + live v4)
  const page1Live = await Page.create({
    slug: 'architecture-overview',
    title: 'System Architecture & Data Flow',
    content: `# System Architecture & Data Flow

## 1. Overview
The platform utilizes a decoupled, event-driven architecture designed for high availability and strong auditability.

## 2. Core Components
- **API Gateway**: Reverse proxy handling SSL termination and rate limiting.
- **Documentation Engine**: Node.js + Express backend with Mongoose ODM.
- **Database Tier**: Standalone MongoDB cluster with dual-collection version isolation (\`pages\` and \`page_revisions\`).
- **Audit Logging**: Every mutating action creates an immutable revision prior to live record update.

## 3. Storage Hierarchy
Live document state resides in \`pages\` for fast read access. Historical revisions reside in \`page_revisions\` indexed by \`{ pageId: 1, version: -1 }\`.

## 4. Disaster Recovery & Rollback
Rollbacks can be initiated instantaneously without data loss; current live states are archived before restoration.`,
    currentVersion: 4,
    status: 'active',
  });

  await PageRevision.create({
    pageId: page1Live._id,
    version: 1,
    title: 'Initial Architecture Notes',
    content: `# Initial Architecture Notes\n\nBasic monolithic Express app connecting to MongoDB.`,
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
    changedBy: 'Alice Chen (Principal Engineer)',
  });

  await PageRevision.create({
    pageId: page1Live._id,
    version: 2,
    title: 'System Architecture (Draft 2)',
    content: `# System Architecture (Draft 2)\n\n## Overview\nIntroduced decoupled microservices and MongoDB dual-collection design.`,
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4),
    changedBy: 'Bob Vance (Cloud Architect)',
  });

  await PageRevision.create({
    pageId: page1Live._id,
    version: 3,
    title: 'System Architecture & Data Flow',
    content: `# System Architecture & Data Flow\n\n## Overview\nAdded security compliance and audit logs. Disaster recovery plan still pending.`,
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 12),
    changedBy: 'Charlie Day (SecOps Lead)',
  });

  // 2. REST API Conventions (2 past revisions + live v3)
  const page2Live = await Page.create({
    slug: 'api-guidelines',
    title: 'REST API Design & Conventions',
    content: `# REST API Design & Conventions

## URL Naming
- Use kebab-case for resource identifiers and parameters: \`/api/pages/:slug/revisions\`.
- Plural nouns for collections: \`/pages\`, \`/revisions\`.

## Response Envelopes
JSON responses return standard payload structures with appropriate HTTP status codes:
- \`200 OK\`: Successful fetch or update.
- \`201 Created\`: Successful creation.
- \`400 Bad Request\`: Input validation failures.
- \`404 Not Found\`: Resource missing.
- \`409 Conflict\`: Duplicate unique key.

## Version Querying
Revision histories are queryable by compound index for $O(\\log N)$ lookup performance.`,
    currentVersion: 3,
    status: 'active',
  });

  await PageRevision.create({
    pageId: page2Live._id,
    version: 1,
    title: 'API Standards',
    content: `# API Standards\n\nInitial draft for endpoint routes.`,
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
    changedBy: 'David Kim (Backend Dev)',
  });

  await PageRevision.create({
    pageId: page2Live._id,
    version: 2,
    title: 'REST API Design & Conventions',
    content: `# REST API Design & Conventions\n\nDraft with response codes and JSON format.`,
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
    changedBy: 'Elena Rostova (Tech Lead)',
  });

  // 3. Deployment Playbook (1 past revision + live v2)
  const page3Live = await Page.create({
    slug: 'deployment-playbook',
    title: 'Production Deployment Playbook',
    content: `# Production Deployment Playbook

## Pre-deployment Checklist
1. Run test suite: \`npm test\`
2. Verify MongoDB connection string in \`.env\`
3. Verify compound index creation with \`npm run explain\`
4. Check that background workers are healthy

## Deployment Procedure
1. Pull latest tagged release.
2. Install production dependencies: \`npm ci --omit=dev\`
3. Run schema migrations / index checks.
4. Restart application processes via process manager.`,
    currentVersion: 2,
    status: 'active',
  });

  await PageRevision.create({
    pageId: page3Live._id,
    version: 1,
    title: 'Deployment Checklist',
    content: `# Deployment Checklist\n\n1. Copy files to server.\n2. Run node server.js.`,
    archivedAt: new Date(Date.now() - 1000 * 60 * 60 * 36),
    changedBy: 'DevOps Pipeline',
  });

  return [page1Live, page2Live, page3Live];
}

module.exports = { seedWikiData };

