const express = require('express');
const router = express.Router();
const pageController = require('../controllers/pageController');

// 1. Pages Collection routes
router.post('/seed', pageController.seedDatabaseHandler);
router.post('/pages', pageController.createPage);
router.get('/pages', pageController.listPages);
router.get('/pages/:slug', pageController.getPageBySlug);
router.put('/pages/:slug', pageController.editPage);
router.delete('/pages/:slug', pageController.archivePage);
router.patch('/pages/:slug/restore', pageController.restorePage);

// 2. Revisions & Rollback routes
// Note: '/revisions/explain' must be declared before '/revisions/:version'
router.get('/pages/:slug/revisions/explain', pageController.getRevisionExplainStats);
router.get('/pages/:slug/revisions', pageController.getRevisionHistory);
router.get('/pages/:slug/revisions/:version', pageController.getSpecificVersion);
router.post('/pages/:slug/rollback/:version', pageController.rollbackPage);

module.exports = router;
