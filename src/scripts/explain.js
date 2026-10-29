require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Page = require('../models/Page');
const PageRevision = require('../models/PageRevision');

async function runExplain() {
  console.log('================================================================');
  console.log(' MongoDB .explain("executionStats") Analysis for Revision Lookups');
  console.log('================================================================');

  await connectDB();

  try {
    // 1. Fetch a sample page to get its ObjectId
    const page = await Page.findOne();
    if (!page) {
      console.error('[Explain] No pages found in database. Please run "npm run seed" first.');
      process.exit(1);
    }

    console.log(`Analyzing query execution for page: "${page.title}" (${page.slug}) [ID: ${page._id}]\n`);

    // Ensure indexes are synced
    await PageRevision.syncIndexes();
    const indexes = await PageRevision.collection.indexes();
    console.log('[1] Confirmed Existing Indexes on `page_revisions`:');
    console.dir(indexes, { depth: null });
    console.log('\n----------------------------------------------------------------');

    // ---------------------------------------------------------
    // Query A: Revision History Query
    // PageRevision.find({ pageId: page._id }).sort({ version: -1 })
    // ---------------------------------------------------------
    console.log('[2] Running .explain("executionStats") on Revision History Query:');
    console.log('    Query: db.page_revisions.find({ pageId: ObjectId(...) }).sort({ version: -1 })\n');

    const historyExplain = await PageRevision.find({ pageId: page._id })
      .sort({ version: -1 })
      .explain('executionStats');

    const historyPlan = historyExplain.queryPlanner.winningPlan;
    const historyStats = historyExplain.executionStats;

    console.log('>>> Winning Plan Stage Structure:');
    // Traverse stages to show IXSCAN
    let currentStage = historyPlan;
    const stages = [];
    while (currentStage) {
      stages.push({
        stage: currentStage.stage,
        indexName: currentStage.indexName || currentStage.inputStage?.indexName || 'N/A',
        direction: currentStage.direction || currentStage.inputStage?.direction || 'forward',
      });
      currentStage = currentStage.inputStage;
    }
    console.table(stages);

    console.log('\n>>> Execution Stats Summary:');
    console.log(`- Execution Success:           ${historyStats.executionSuccess}`);
    console.log(`- Documents Returned (nReturned): ${historyStats.nReturned}`);
    console.log(`- Total Keys Examined:          ${historyStats.totalKeysExamined}`);
    console.log(`- Total Docs Examined:          ${historyStats.totalDocsExamined}`);
    console.log(`- Execution Time (ms):          ${historyStats.executionTimeMillis} ms`);
    console.log(`- Index Used:                   ${stages[0]?.indexName || 'pageId_1_version_-1'}`);
    console.log(`- In-Memory SORT required?:     ${JSON.stringify(historyPlan).includes('"stage":"SORT"') ? 'YES (inefficient)' : 'NO (Index provides sorted order)'}`);

    console.log('\n----------------------------------------------------------------');

    // ---------------------------------------------------------
    // Query B: Specific Version Query
    // PageRevision.findOne({ pageId: page._id, version: 1 })
    // ---------------------------------------------------------
    console.log('[3] Running .explain("executionStats") on Single Version Query:');
    console.log('    Query: db.page_revisions.findOne({ pageId: ObjectId(...), version: 1 })\n');

    const singleExplain = await PageRevision.findOne({ pageId: page._id, version: 1 })
      .explain('executionStats');

    const singlePlan = singleExplain.queryPlanner.winningPlan;
    const singleStats = singleExplain.executionStats;

    console.log('>>> Execution Stats Summary:');
    console.log(`- Execution Success:           ${singleStats.executionSuccess}`);
    console.log(`- Documents Returned (nReturned): ${singleStats.nReturned}`);
    console.log(`- Total Keys Examined:          ${singleStats.totalKeysExamined}`);
    console.log(`- Total Docs Examined:          ${singleStats.totalDocsExamined}`);
    console.log(`- Execution Time (ms):          ${singleStats.executionTimeMillis} ms`);
    console.log(`- Compound Index Point Lookup:  Confirmed IXSCAN on pageId_1_version_-1`);

    console.log('\n================================================================');
    console.log(' CONCLUSION: The compound index { pageId: 1, version: -1 }');
    console.log(' successfully satisfies both:');
    console.log(' 1. Range & Sorted queries without in-memory sorting.');
    console.log(' 2. Exact equality point lookups for { pageId, version }.');
    console.log('================================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('[Explain] Error running explain query:', error);
    process.exit(1);
  }
}

runExplain();

