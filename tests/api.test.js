require('dotenv').config();
const http = require('http');
const connectDB = require('../src/config/db');
const app = require('../server');
const Page = require('../src/models/Page');
const PageRevision = require('../src/models/PageRevision');

let server;
let baseUrl;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, data: json });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log(' Starting Automated End-to-End API Test Suite');
  console.log('================================================================\n');

  // Start test server on random port
  const PORT = 3001;
  baseUrl = `http://localhost:${PORT}`;
  server = app.listen(PORT);

  // Allow server and DB connection
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    // ----------------------------------------------------------------
    // Test 1: Seed / Reset Data
    // ----------------------------------------------------------------
    console.log('[Test 1] Reset test database state via /api/seed...');
    const seedRes = await request('POST', '/api/seed');
    assert(seedRes.status === 200, `Expected 200, got ${seedRes.status}`);
    console.log('  ✓ Seeded successfully\n');

    // ----------------------------------------------------------------
    // Test 2: List Pages (Active only, sorted by updatedAt descending)
    // ----------------------------------------------------------------
    console.log('[Test 2] GET /api/pages - List active pages...');
    const listRes = await request('GET', '/api/pages');
    assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
    assert(Array.isArray(listRes.data.pages), 'Expected pages array');
    assert(listRes.data.pages.length === 3, `Expected 3 pages, found ${listRes.data.pages.length}`);
    listRes.data.pages.forEach((p) => {
      assert(p.status === 'active', `Expected active status, got ${p.status}`);
    });
    console.log(`  ✓ Returned ${listRes.data.pages.length} active pages, all status="active"\n`);

    // ----------------------------------------------------------------
    // Test 3: Validation Errors on Create Page
    // ----------------------------------------------------------------
    console.log('[Test 3] POST /api/pages - Input validation checks...');
    // Missing title
    const valRes1 = await request('POST', '/api/pages', { content: 'hello' });
    assert(valRes1.status === 400, `Expected 400 for missing title, got ${valRes1.status}`);

    // Missing content
    const valRes2 = await request('POST', '/api/pages', { title: 'Test' });
    assert(valRes2.status === 400, `Expected 400 for missing content, got ${valRes2.status}`);

    // Invalid slug format
    const valRes3 = await request('POST', '/api/pages', {
      title: 'Bad Slug Test',
      slug: 'invalid_slug_with_underscores!',
      content: 'Sample',
    });
    assert(valRes3.status === 400, `Expected 400 for invalid slug, got ${valRes3.status}`);
    console.log('  ✓ Input validation handled properly with 400 Bad Request\n');

    // ----------------------------------------------------------------
    // Test 4: Create New Page (currentVersion: 1, no revision yet)
    // ----------------------------------------------------------------
    console.log('[Test 4] POST /api/pages - Create valid page...');
    const createRes = await request('POST', '/api/pages', {
      title: 'Microservices Guide',
      slug: 'microservices-guide',
      content: '# Microservices Guide\n\nInitial draft of service boundaries.',
      changedBy: 'Developer Dave',
    });
    assert(createRes.status === 201, `Expected 201 Created, got ${createRes.status}`);
    assert(createRes.data.page.currentVersion === 1, `Expected version 1, got ${createRes.data.page.currentVersion}`);
    assert(createRes.data.page.slug === 'microservices-guide', 'Expected slug match');

    // Verify no revisions exist yet for this new page
    const newPageRevisions = await request('GET', '/api/pages/microservices-guide/revisions');
    assert(newPageRevisions.data.revisionCount === 0, `Expected 0 revisions for newly created page, got ${newPageRevisions.data.revisionCount}`);
    console.log('  ✓ Page created at currentVersion=1 with 0 revisions\n');

    // ----------------------------------------------------------------
    // Test 5: Duplicate Slug Prevention (409 Conflict)
    // ----------------------------------------------------------------
    console.log('[Test 5] POST /api/pages - Prevent duplicate slug collision...');
    const dupRes = await request('POST', '/api/pages', {
      title: 'Microservices Duplicate',
      slug: 'microservices-guide',
      content: 'Duplicate body',
    });
    assert(dupRes.status === 409, `Expected 409 Conflict, got ${dupRes.status}`);
    console.log('  ✓ Conflict properly detected with 409\n');

    // ----------------------------------------------------------------
    // Test 6: Edit Page (Write revision first, update live doc, increment version)
    // ----------------------------------------------------------------
    console.log('[Test 6] PUT /api/pages/:slug - Edit page (v1 -> v2)...');
    const editRes1 = await request('PUT', '/api/pages/microservices-guide', {
      title: 'Microservices Guide (Expanded)',
      content: '# Microservices Guide\n\nAdded Kafka and RabbitMQ messaging.',
      changedBy: 'Alice Architect',
    });
    assert(editRes1.status === 200, `Expected 200, got ${editRes1.status}`);
    assert(editRes1.data.page.currentVersion === 2, `Expected live version 2, got ${editRes1.data.page.currentVersion}`);
    assert(editRes1.data.archivedRevision.version === 1, `Expected archived revision v1, got ${editRes1.data.archivedRevision.version}`);
    assert(editRes1.data.archivedRevision.changedBy === 'Alice Architect', 'Expected author captured');

    // Edit a second time (v2 -> v3)
    console.log('  Editing again (v2 -> v3)...');
    const editRes2 = await request('PUT', '/api/pages/microservices-guide', {
      title: 'Microservices Guide (Final Release)',
      content: '# Microservices Guide\n\nAdded gRPC RPC definitions and health check probes.',
      changedBy: 'Bob Tech Lead',
    });
    assert(editRes2.status === 200, `Expected 200, got ${editRes2.status}`);
    assert(editRes2.data.page.currentVersion === 3, `Expected live version 3, got ${editRes2.data.page.currentVersion}`);
    assert(editRes2.data.archivedRevision.version === 2, `Expected archived revision v2, got ${editRes2.data.archivedRevision.version}`);
    console.log('  ✓ Revisions sequentially archived and live version incremented\n');

    // ----------------------------------------------------------------
    // Test 7: Get Revision History (sorted by version descending)
    // ----------------------------------------------------------------
    console.log('[Test 7] GET /api/pages/:slug/revisions - Fetch revision history...');
    const histRes = await request('GET', '/api/pages/microservices-guide/revisions');
    assert(histRes.status === 200, `Expected 200, got ${histRes.status}`);
    assert(histRes.data.revisionCount === 2, `Expected 2 past revisions, got ${histRes.data.revisionCount}`);
    assert(histRes.data.revisions[0].version === 2, 'Expected first revision in list to be v2 (descending order)');
    assert(histRes.data.revisions[1].version === 1, 'Expected second revision in list to be v1 (descending order)');
    console.log('  ✓ Revisions returned correctly sorted by version descending\n');

    // ----------------------------------------------------------------
    // Test 8: Get Specific Version (pageId + version query)
    // ----------------------------------------------------------------
    console.log('[Test 8] GET /api/pages/:slug/revisions/:version - Single version lookup...');
    const rev1Res = await request('GET', '/api/pages/microservices-guide/revisions/1');
    assert(rev1Res.status === 200, `Expected 200, got ${rev1Res.status}`);
    assert(rev1Res.data.version === 1, 'Expected version 1');
    assert(rev1Res.data.title === 'Microservices Guide', `Expected title match, got ${rev1Res.data.title}`);

    // Missing version (404)
    const missingRev = await request('GET', '/api/pages/microservices-guide/revisions/999');
    assert(missingRev.status === 404, `Expected 404 for non-existent revision, got ${missingRev.status}`);
    console.log('  ✓ Single version lookup correctly retrieved by pageId + version\n');

    // ----------------------------------------------------------------
    // Test 9: Rollback (archive live state as revision, restore old version, inc version)
    // ----------------------------------------------------------------
    console.log('[Test 9] POST /api/pages/:slug/rollback/:version - Rollback to v1...');
    // Live page is currently at v3.
    // Rolling back to v1 should:
    // (a) archive current live v3 into page_revisions
    // (b) overwrite live doc with v1 title & content
    // (c) increment live version to v4
    const rollbackRes = await request('POST', '/api/pages/microservices-guide/rollback/1', {
      changedBy: 'Rollback Admin',
    });
    assert(rollbackRes.status === 200, `Expected 200, got ${rollbackRes.status}`);
    assert(rollbackRes.data.newLiveVersion === 4, `Expected new live version 4, got ${rollbackRes.data.newLiveVersion}`);
    assert(rollbackRes.data.restoredFromVersion === 1, `Expected restored from version 1`);
    assert(rollbackRes.data.page.title === 'Microservices Guide', 'Expected live title restored from v1');
    assert(rollbackRes.data.page.content.includes('Initial draft of service boundaries'), 'Expected content restored from v1');

    // Verify history now includes v3 as an archived revision
    const postRollbackHist = await request('GET', '/api/pages/microservices-guide/revisions');
    assert(postRollbackHist.data.revisionCount === 3, `Expected 3 revisions now, got ${postRollbackHist.data.revisionCount}`);
    assert(postRollbackHist.data.revisions[0].version === 3, 'Latest archived revision should be v3');
    console.log('  ✓ Rollback successfully executed with auditable revision trail\n');

    // ----------------------------------------------------------------
    // Test 10: Soft Delete / Archive (status: 'archived', excluded from list)
    // ----------------------------------------------------------------
    console.log('[Test 10] DELETE /api/pages/:slug - Soft delete (archive)...');
    const archiveRes = await request('DELETE', '/api/pages/microservices-guide');
    assert(archiveRes.status === 200, `Expected 200, got ${archiveRes.status}`);
    assert(archiveRes.data.page.status === 'archived', 'Expected status to be archived');

    // Verify it is excluded from active pages list
    const activeList = await request('GET', '/api/pages');
    const existsInActive = activeList.data.pages.some((p) => p.slug === 'microservices-guide');
    assert(!existsInActive, 'Archived page must NOT appear in default active list');

    // Verify it IS returned when includeArchived=true
    const allList = await request('GET', '/api/pages?includeArchived=true');
    const existsInAll = allList.data.pages.some((p) => p.slug === 'microservices-guide');
    assert(existsInAll, 'Archived page MUST appear when includeArchived=true');
    console.log('  ✓ Soft delete archived page properly and excluded it from active list\n');

    // ----------------------------------------------------------------
    // Test 11: Restore Soft Deleted Page
    // ----------------------------------------------------------------
    console.log('[Test 11] PATCH /api/pages/:slug/restore - Restore archived page...');
    const restoreRes = await request('PATCH', '/api/pages/microservices-guide/restore');
    assert(restoreRes.status === 200, `Expected 200, got ${restoreRes.status}`);
    assert(restoreRes.data.page.status === 'active', 'Expected status to be restored to active');

    const activeListAgain = await request('GET', '/api/pages');
    const existsAgain = activeListAgain.data.pages.some((p) => p.slug === 'microservices-guide');
    assert(existsAgain, 'Restored page should appear in active list');
    console.log('  ✓ Page restored to active status successfully\n');

    // ----------------------------------------------------------------
    // Test 12: Explain Stats API Endpoint
    // ----------------------------------------------------------------
    console.log('[Test 12] GET /api/pages/:slug/revisions/explain - Compound index verification...');
    const explainRes = await request('GET', '/api/pages/microservices-guide/revisions/explain');
    assert(explainRes.status === 200, `Expected 200, got ${explainRes.status}`);
    assert(explainRes.data.compoundIndex === 'pageId_1_version_-1', 'Compound index identified');
    assert(explainRes.data.historyQueryExplain.executionStats.executionSuccess === true, 'Execution success');
    console.log('  ✓ Explain stats verified compound index utilization\n');

    console.log('================================================================');
    console.log(' ALL 12 END-TO-END TESTS PASSED SUCCESSFULLY! ✓');
    console.log('================================================================\n');

    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failure:', err.message);
    if (server) server.close();
    process.exit(1);
  }
}

runTests();

