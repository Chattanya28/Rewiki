const mongoose = require('mongoose');
const Page = require('../models/Page');
const PageRevision = require('../models/PageRevision');
const { slugify, isValidSlug } = require('../utils/slugify');
const { seedWikiData } = require('../utils/seeder');

/**
 * Controller for Versioned Documentation / Wiki System
 */

// 1. Create a new page
// POST /api/pages
exports.createPage = async (req, res, next) => {
  try {
    let { title, content, slug, changedBy } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title is required and must be a non-empty string' });
    }

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required and must be a string' });
    }

    // Generate slug from title if not explicitly provided
    if (!slug || !slug.trim()) {
      slug = slugify(title);
    } else {
      slug = slug.trim().toLowerCase();
    }

    if (!isValidSlug(slug)) {
      return res.status(400).json({
        error: `Invalid slug '${slug}'. Must contain only lowercase alphanumeric characters and single hyphens.`,
      });
    }

    // Check slug collision
    const existingPage = await Page.findOne({ slug });
    if (existingPage) {
      return res.status(409).json({
        error: `A page with slug '${slug}' already exists. Please choose a different title or custom slug.`,
      });
    }

    // Create page with currentVersion: 1 and status: 'active'. No revision yet.
    const page = await Page.create({
      title: title.trim(),
      slug,
      content,
      currentVersion: 1,
      status: 'active',
    });

    return res.status(201).json({
      message: 'Page created successfully',
      page,
    });
  } catch (error) {
    next(error);
  }
};

// 2. List pages (active pages only, sorted by updatedAt descending)
// GET /api/pages
exports.listPages = async (req, res, next) => {
  try {
    const { includeArchived } = req.query;
    const filter = includeArchived === 'true' ? {} : { status: 'active' };

    const pages = await Page.find(filter)
      .sort({ updatedAt: -1 })
      .select('title slug currentVersion status createdAt updatedAt');

    return res.json({
      count: pages.length,
      pages,
    });
  } catch (error) {
    next(error);
  }
};

// 3. Get single page by slug
// GET /api/pages/:slug
exports.getPageBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const page = await Page.findOne({ slug: slug.toLowerCase() });

    if (!page) {
      return res.status(404).json({ error: `Page with slug '${slug}' not found` });
    }

    return res.json({ page });
  } catch (error) {
    next(error);
  }
};

// 4. Edit page
// PUT /api/pages/:slug
// Order matters: Write the revision first, then update the live page and increment currentVersion.
exports.editPage = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { title, content, changedBy } = req.body;

    if (!title && content === undefined) {
      return res.status(400).json({ error: 'Please provide title or content to update' });
    }

    // Step 1: Find current live page
    const livePage = await Page.findOne({ slug: slug.toLowerCase() });
    if (!livePage) {
      return res.status(404).json({ error: `Page with slug '${slug}' not found` });
    }

    if (livePage.status === 'archived') {
      return res.status(400).json({ error: 'Cannot edit an archived page. Restore it first.' });
    }

    const nextTitle = title ? title.trim() : livePage.title;
    const nextContent = content !== undefined ? content : livePage.content;

    // Check if anything actually changed
    const isUnchanged = nextTitle === livePage.title && nextContent === livePage.content;
    if (isUnchanged) {
      return res.status(200).json({
        message: 'No changes detected. Page remains at current version.',
        page: livePage,
      });
    }

    // Step 2: Archive current live state into page_revisions BEFORE updating live page
    const revisionRecord = await PageRevision.create({
      pageId: livePage._id,
      version: livePage.currentVersion,
      title: livePage.title,
      content: livePage.content,
      archivedAt: new Date(),
      changedBy: changedBy ? changedBy.trim() : 'Anonymous',
    });

    // Step 3: Update live page and increment currentVersion
    const updatedPage = await Page.findByIdAndUpdate(
      livePage._id,
      {
        $set: {
          title: nextTitle,
          content: nextContent,
        },
        $inc: { currentVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    return res.json({
      message: `Page updated successfully. Previous state archived as revision v${livePage.currentVersion}. Now at v${updatedPage.currentVersion}.`,
      archivedRevision: {
        id: revisionRecord._id,
        version: revisionRecord.version,
        archivedAt: revisionRecord.archivedAt,
        changedBy: revisionRecord.changedBy,
      },
      page: updatedPage,
    });
  } catch (error) {
    next(error);
  }
};

// 5. Get revision history for a page
// GET /api/pages/:slug/revisions
// Returns all revisions for a page, sorted by version descending
exports.getRevisionHistory = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const page = await Page.findOne({ slug: slug.toLowerCase() });

    if (!page) {
      return res.status(404).json({ error: `Page with slug '${slug}' not found` });
    }

    // Utilizes compound index { pageId: 1, version: -1 }
    const revisions = await PageRevision.find({ pageId: page._id })
      .sort({ version: -1 })
      .select('version title content archivedAt changedBy createdAt');

    return res.json({
      page: {
        id: page._id,
        slug: page.slug,
        title: page.title,
        currentVersion: page.currentVersion,
        status: page.status,
      },
      revisionCount: revisions.length,
      revisions,
    });
  } catch (error) {
    next(error);
  }
};

// 6. Get specific version of a page
// GET /api/pages/:slug/revisions/:version
// Push authorization-adjacent logic into query: fetching by both pageId and version in one query
exports.getSpecificVersion = async (req, res, next) => {
  try {
    const { slug, version } = req.params;
    const versionNum = parseInt(version, 10);

    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: 'Version must be a positive integer' });
    }

    const page = await Page.findOne({ slug: slug.toLowerCase() });
    if (!page) {
      return res.status(404).json({ error: `Page with slug '${slug}' not found` });
    }

    // If requested version is the current live version, return live doc marked as live
    if (versionNum === page.currentVersion) {
      return res.json({
        isLive: true,
        pageId: page._id,
        version: page.currentVersion,
        title: page.title,
        content: page.content,
        updatedAt: page.updatedAt,
        status: page.status,
        note: 'This is the current live version of the page',
      });
    }

    // Query revision using both pageId and version in a single query (compound index match)
    const revision = await PageRevision.findOne({
      pageId: page._id,
      version: versionNum,
    });

    if (!revision) {
      return res.status(404).json({
        error: `Revision v${versionNum} not found for page '${slug}'`,
      });
    }

    return res.json({
      isLive: false,
      pageId: page._id,
      version: revision.version,
      title: revision.title,
      content: revision.content,
      archivedAt: revision.archivedAt,
      changedBy: revision.changedBy,
    });
  } catch (error) {
    next(error);
  }
};

// 7. Rollback to a past version
// POST /api/pages/:slug/rollback/:version
// Restores a past version:
// (a) archive current live state as a new revision
// (b) overwrite live page with old version's title and content
// (c) increment currentVersion
// Auditable state preserved
exports.rollbackPage = async (req, res, next) => {
  try {
    const { slug, version } = req.params;
    const targetVersionNum = parseInt(version, 10);

    if (isNaN(targetVersionNum) || targetVersionNum < 1) {
      return res.status(400).json({ error: 'Target version must be a positive integer' });
    }

    const livePage = await Page.findOne({ slug: slug.toLowerCase() });
    if (!livePage) {
      return res.status(404).json({ error: `Page with slug '${slug}' not found` });
    }

    if (livePage.currentVersion === targetVersionNum) {
      return res.status(400).json({
        error: `Page is already at version ${targetVersionNum}. Rollback not needed.`,
      });
    }

    // Locate target version from page_revisions in a single compound-indexed query
    const targetRevision = await PageRevision.findOne({
      pageId: livePage._id,
      version: targetVersionNum,
    });

    if (!targetRevision) {
      return res.status(404).json({
        error: `Cannot rollback: Revision v${targetVersionNum} does not exist for page '${slug}'.`,
      });
    }

    const author = req.body.changedBy ? req.body.changedBy.trim() : 'System/Rollback';
    const auditReason = `Rollback from v${livePage.currentVersion} to v${targetVersionNum} by ${author}`;

    // (a) Archive current live state as a new revision first
    const archivedPreRollback = await PageRevision.create({
      pageId: livePage._id,
      version: livePage.currentVersion,
      title: livePage.title,
      content: livePage.content,
      archivedAt: new Date(),
      changedBy: auditReason,
    });

    // (b & c) Overwrite live page with old version's title & content, and increment currentVersion
    const updatedLivePage = await Page.findByIdAndUpdate(
      livePage._id,
      {
        $set: {
          title: targetRevision.title,
          content: targetRevision.content,
        },
        $inc: { currentVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    return res.json({
      message: `Successfully rolled back '${livePage.slug}' to content of v${targetVersionNum}. Live page updated to v${updatedLivePage.currentVersion}.`,
      restoredFromVersion: targetVersionNum,
      archivedLiveVersion: archivedPreRollback.version,
      newLiveVersion: updatedLivePage.currentVersion,
      page: updatedLivePage,
    });
  } catch (error) {
    next(error);
  }
};

// 8. Soft delete / Archive page
// DELETE /api/pages/:slug
// Sets status: 'archived' instead of deleting
exports.archivePage = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const archivedPage = await Page.findOneAndUpdate(
      { slug: slug.toLowerCase(), status: 'active' },
      { $set: { status: 'archived' } },
      { new: true }
    );

    if (!archivedPage) {
      // Check if page exists but is already archived
      const checkPage = await Page.findOne({ slug: slug.toLowerCase() });
      if (!checkPage) {
        return res.status(404).json({ error: `Page with slug '${slug}' not found` });
      }
      return res.status(400).json({ error: `Page '${slug}' is already archived` });
    }

    return res.json({
      message: `Page '${slug}' has been archived (soft deleted). It will no longer appear in active page listings.`,
      page: archivedPage,
    });
  } catch (error) {
    next(error);
  }
};

// 9. Restore / Unarchive page
// PATCH /api/pages/:slug/restore
exports.restorePage = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const restoredPage = await Page.findOneAndUpdate(
      { slug: slug.toLowerCase(), status: 'archived' },
      { $set: { status: 'active' } },
      { new: true }
    );

    if (!restoredPage) {
      const checkPage = await Page.findOne({ slug: slug.toLowerCase() });
      if (!checkPage) {
        return res.status(404).json({ error: `Page with slug '${slug}' not found` });
      }
      return res.status(400).json({ error: `Page '${slug}' is already active` });
    }

    return res.json({
      message: `Page '${slug}' has been restored to active status.`,
      page: restoredPage,
    });
  } catch (error) {
    next(error);
  }
};

// 10. Run executionStats explain query on revision lookup
// GET /api/pages/:slug/revisions/explain
exports.getRevisionExplainStats = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const page = await Page.findOne({ slug: slug.toLowerCase() });

    if (!page) {
      return res.status(404).json({ error: `Page with slug '${slug}' not found` });
    }

    // Explain query for all revisions of a page sorted by version descending
    const historyExplain = await PageRevision.find({ pageId: page._id })
      .sort({ version: -1 })
      .explain('executionStats');

    // Explain query for single specific revision lookup { pageId, version }
    const singleVersionExplain = await PageRevision.findOne({
      pageId: page._id,
      version: 1,
    }).explain('executionStats');

    return res.json({
      compoundIndex: 'pageId_1_version_-1',
      page: {
        id: page._id,
        slug: page.slug,
      },
      historyQueryExplain: {
        winningPlan: historyExplain.queryPlanner?.winningPlan,
        executionStats: historyExplain.executionStats,
      },
      singleVersionQueryExplain: {
        winningPlan: singleVersionExplain.queryPlanner?.winningPlan,
        executionStats: singleVersionExplain.executionStats,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 11. Optional developer endpoint to trigger seed data
// POST /api/seed
exports.seedDatabaseHandler = async (req, res, next) => {
  try {
    const pages = await seedWikiData();
    return res.json({
      message: 'Database seeded successfully with sample documentation pages and revisions',
      pagesCount: pages.length,
    });
  } catch (error) {
    next(error);
  }
};
