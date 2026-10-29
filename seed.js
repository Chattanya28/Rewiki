require('dotenv').config();
const connectDB = require('./src/config/db');
const { seedWikiData } = require('./src/utils/seeder');

async function run() {
  console.log('[Seed] Connecting to MongoDB...');
  await connectDB();

  try {
    const pages = await seedWikiData();
    console.log('[Seed] Seeding completed successfully!');
    console.log('------------------------------------------------------------');
    pages.forEach((p) => {
      console.log(`- Created Page: "${p.title}" (${p.slug}) [Current: v${p.currentVersion}]`);
    });
    console.log('------------------------------------------------------------');
    console.log('Ready! Run "npm start" to launch the server.');
    process.exit(0);
  } catch (error) {
    console.error('[Seed] Seeding failed:', error);
    process.exit(1);
  }
}

run();
