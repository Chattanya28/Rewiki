/**
 * DocuVault Frontend Application
 * Interacts with Node.js + Express + Mongoose versioned wiki API.
 */

// Application State
const state = {
  pages: [],
  selectedSlug: null,
  currentPage: null,
  currentFilter: 'active', // 'active' or 'all'
  searchQuery: '',
  viewingSnapshot: null, // holds historical revision object if active
};

// DOM Elements
const el = {
  sidebarPages: document.getElementById('sidebar-pages'),
  pageCountBadge: document.getElementById('page-count-badge'),
  pageSearch: document.getElementById('page-search'),
  filterTabs: document.querySelectorAll('.filter-tab'),
  emptyState: document.getElementById('empty-state'),
  articlePane: document.getElementById('article-pane'),
  badgeVersion: document.getElementById('badge-version'),
  badgeStatus: document.getElementById('badge-status'),
  textSlug: document.getElementById('text-slug'),
  textTitle: document.getElementById('text-title'),
  textUpdatedAt: document.getElementById('text-updated-at'),
  textRevisionCount: document.getElementById('text-revision-count'),
  renderedContent: document.getElementById('rendered-content'),
  snapshotBanner: document.getElementById('snapshot-banner'),
  snapshotVersionLabel: document.getElementById('snapshot-version-label'),
  snapshotMetaLabel: document.getElementById('snapshot-meta-label'),
  btnSnapshotRollback: document.getElementById('btn-snapshot-rollback'),
  btnSnapshotExit: document.getElementById('btn-snapshot-exit'),
  btnEditPage: document.getElementById('btn-edit-page'),
  btnViewHistory: document.getElementById('btn-view-history'),
  btnViewExplain: document.getElementById('btn-view-explain'),
  btnArchivePage: document.getElementById('btn-archive-page'),
  btnRestorePage: document.getElementById('btn-restore-page'),
  btnSeed: document.getElementById('btn-seed'),
  btnCreateOpen: document.getElementById('btn-create-page-open'),
  toastContainer: document.getElementById('toast-container'),
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadPages();
});

// Event Listeners Setup
function setupEventListeners() {
  // Search
  el.pageSearch.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    renderSidebar();
  });

  // Filter tabs
  el.filterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      el.filterTabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      state.currentFilter = tab.dataset.filter;
      loadPages();
    });
  });

  // Topbar actions
  el.btnCreateOpen.addEventListener('click', () => openCreateModal());
  el.btnSeed.addEventListener('click', triggerSeedData);

  // Article Action Buttons
  el.btnEditPage.addEventListener('click', () => {
    if (state.currentPage) openEditModal(state.currentPage);
  });

  el.btnViewHistory.addEventListener('click', () => {
    if (state.selectedSlug) openHistoryModal(state.selectedSlug);
  });

  el.btnViewExplain.addEventListener('click', () => {
    if (state.selectedSlug) openExplainModal(state.selectedSlug);
  });

  el.btnArchivePage.addEventListener('click', () => {
    if (state.selectedSlug) archiveCurrentPage();
  });

  el.btnRestorePage.addEventListener('click', () => {
    if (state.selectedSlug) restoreCurrentPage();
  });

  // Snapshot actions
  el.btnSnapshotExit.addEventListener('click', exitSnapshotView);
  el.btnSnapshotRollback.addEventListener('click', () => {
    if (state.viewingSnapshot) {
      openRollbackModal(state.viewingSnapshot.version);
    }
  });

  // Create Form
  const formCreate = document.getElementById('form-create-page');
  const createTitle = document.getElementById('create-title');
  const createSlug = document.getElementById('create-slug');

  createTitle.addEventListener('input', () => {
    if (!createSlug.dataset.manual) {
      createSlug.value = slugifyText(createTitle.value);
    }
  });

  createSlug.addEventListener('input', () => {
    createSlug.dataset.manual = 'true';
  });

  formCreate.addEventListener('submit', handleCreatePage);

  // Edit Form
  const formEdit = document.getElementById('form-edit-page');
  formEdit.addEventListener('submit', handleEditPage);

  // Rollback Form
  const formRollback = document.getElementById('form-rollback');
  formRollback.addEventListener('submit', handleExecuteRollback);

  // Keyboard escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.style.display = 'none';
      });
    }
  });
}

// Helpers
function slugifyText(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(isoStr) {
  if (!isoStr) return 'N/A';
  const d = new Date(isoStr);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderMarkdown(md) {
  if (!md) return '<p><em>No content provided</em></p>';
  if (typeof marked !== 'undefined' && marked.parse) {
    return marked.parse(md);
  }
  // Safe basic fallback
  return `<pre>${escapeHtml(md)}</pre>`;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[m]));
}

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: 'fa-circle-check text-success',
    error: 'fa-circle-exclamation text-danger',
    warning: 'fa-triangle-exclamation text-warning',
    info: 'fa-circle-info',
  };

  toast.innerHTML = `
    <i class="fa-solid ${iconMap[type] || 'fa-bell'}"></i>
    <span>${message}</span>
  `;

  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Modal Control
window.openModal = function (id) {
  document.getElementById(id).style.display = 'flex';
};

window.closeModal = function (id) {
  document.getElementById(id).style.display = 'none';
};

// API: Load Pages
async function loadPages(selectFirst = false) {
  try {
    const includeArchived = state.currentFilter === 'all';
    const res = await fetch(`/api/pages?includeArchived=${includeArchived}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to fetch pages');

    state.pages = data.pages || [];
    renderSidebar();

    // Auto-select first page if none selected or if explicitly requested
    if (state.pages.length > 0) {
      if (selectFirst || !state.selectedSlug || !state.pages.find((p) => p.slug === state.selectedSlug)) {
        selectPage(state.pages[0].slug);
      }
    } else {
      showEmptyState();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Render Sidebar List
function renderSidebar() {
  const filtered = state.pages.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(state.searchQuery) ||
      p.slug.toLowerCase().includes(state.searchQuery);
    return matchesSearch;
  });

  el.pageCountBadge.textContent = `${filtered.length} page${filtered.length === 1 ? '' : 's'}`;

  if (filtered.length === 0) {
    el.sidebarPages.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        No pages match your filter.
      </div>
    `;
    return;
  }

  el.sidebarPages.innerHTML = filtered
    .map((p) => {
      const isSelected = p.slug === state.selectedSlug;
      const isArchived = p.status === 'archived';
      return `
      <div class="sidebar-item ${isSelected ? 'active' : ''}" onclick="selectPage('${p.slug}')">
        <div class="sidebar-item-header">
          <span class="sidebar-item-title">${escapeHtml(p.title)}</span>
          <span class="version-badge">v${p.currentVersion}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="sidebar-item-slug">/${p.slug}</span>
          ${isArchived ? '<span class="status-badge status-archived">Archived</span>' : ''}
        </div>
      </div>
    `;
    })
    .join('');
}

// API: Select and Load Single Page
async function selectPage(slug) {
  state.selectedSlug = slug;
  state.viewingSnapshot = null;
  renderSidebar();

  try {
    const res = await fetch(`/api/pages/${slug}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to load page');

    state.currentPage = data.page;
    renderArticle(data.page);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Render Article Pane
async function renderArticle(page) {
  el.emptyState.style.display = 'none';
  el.articlePane.style.display = 'block';

  // Live page attributes
  el.badgeVersion.textContent = `v${page.currentVersion}`;
  el.badgeStatus.textContent = page.status.toUpperCase();
  el.badgeStatus.className = `status-badge ${page.status === 'active' ? 'status-active' : 'status-archived'}`;
  el.textSlug.textContent = page.slug;
  el.textTitle.textContent = page.title;
  el.textUpdatedAt.textContent = formatDate(page.updatedAt || page.createdAt);

  // Status-based actions
  if (page.status === 'archived') {
    el.btnArchivePage.style.display = 'none';
    el.btnRestorePage.style.display = 'inline-flex';
    el.btnEditPage.disabled = true;
    el.btnEditPage.title = 'Cannot edit an archived page. Restore it first.';
  } else {
    el.btnArchivePage.style.display = 'inline-flex';
    el.btnRestorePage.style.display = 'none';
    el.btnEditPage.disabled = false;
    el.btnEditPage.title = 'Edit content & title';
  }

  // Snapshot banner hidden for live page
  el.snapshotBanner.style.display = 'none';

  // Render markdown content
  el.renderedContent.innerHTML = renderMarkdown(page.content);

  // Fetch revisions count for metadata
  try {
    const revRes = await fetch(`/api/pages/${page.slug}/revisions`);
    const revData = await revRes.json();
    if (revRes.ok) {
      el.textRevisionCount.textContent = `${revData.revisionCount} past revision${revData.revisionCount === 1 ? '' : 's'}`;
    }
  } catch (e) {
    // Non-blocking
  }
}

function showEmptyState() {
  state.currentPage = null;
  state.selectedSlug = null;
  el.emptyState.style.display = 'flex';
  el.articlePane.style.display = 'none';
}

// Historical Snapshot View
function viewRevisionSnapshot(rev) {
  state.viewingSnapshot = rev;
  closeModal('modal-history');

  el.snapshotBanner.style.display = 'flex';
  el.snapshotVersionLabel.textContent = `v${rev.version}`;
  el.snapshotMetaLabel.textContent = `Archived on ${formatDate(rev.archivedAt)} by ${rev.changedBy || 'Anonymous'}`;

  el.badgeVersion.textContent = `v${rev.version} (Snapshot)`;
  el.textTitle.textContent = rev.title;
  el.renderedContent.innerHTML = renderMarkdown(rev.content);

  showToast(`Viewing historical snapshot v${rev.version}`, 'info');
}

function exitSnapshotView() {
  if (state.currentPage) {
    selectPage(state.currentPage.slug);
  }
}

// Modal: Open Create Page
window.openCreateModal = function () {
  const form = document.getElementById('form-create-page');
  form.reset();
  const slugInput = document.getElementById('create-slug');
  delete slugInput.dataset.manual;
  openModal('modal-create');
};

// API: Handle Create Page
async function handleCreatePage(e) {
  e.preventDefault();
  const title = document.getElementById('create-title').value.trim();
  const slug = document.getElementById('create-slug').value.trim();
  const content = document.getElementById('create-content').value;
  const changedBy = document.getElementById('create-changed-by').value.trim();

  try {
    const res = await fetch('/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, slug, content, changedBy }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to create page');

    closeModal('modal-create');
    showToast(`Page '${data.page.title}' created successfully!`, 'success');
    await loadPages();
    selectPage(data.page.slug);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Modal: Open Edit Page
function openEditModal(page) {
  document.getElementById('edit-title').value = page.title;
  document.getElementById('edit-content').value = page.content;
  document.getElementById('edit-changed-by').value = '';
  document.getElementById('edit-archived-version-label').textContent = `v${page.currentVersion}`;
  document.getElementById('edit-next-version-label').textContent = `v${page.currentVersion + 1}`;
  openModal('modal-edit');
}

// API: Handle Edit Page
async function handleEditPage(e) {
  e.preventDefault();
  if (!state.currentPage) return;

  const title = document.getElementById('edit-title').value.trim();
  const content = document.getElementById('edit-content').value;
  const changedBy = document.getElementById('edit-changed-by').value.trim();

  try {
    const res = await fetch(`/api/pages/${state.currentPage.slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, changedBy }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to update page');

    closeModal('modal-edit');
    showToast(data.message, 'success');
    await loadPages();
    selectPage(data.page.slug);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Modal: Open History Timeline
async function openHistoryModal(slug) {
  const timelineEl = document.getElementById('revisions-timeline');
  const subtitleEl = document.getElementById('history-subtitle');
  subtitleEl.textContent = `Page: /${slug} (Current live version: v${state.currentPage?.currentVersion || 1})`;

  timelineEl.innerHTML = `
    <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
      <i class="fa-solid fa-circle-notch fa-spin"></i> Fetching indexed revisions...
    </div>
  `;
  openModal('modal-history');

  try {
    const res = await fetch(`/api/pages/${slug}/revisions`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to fetch history');

    if (!data.revisions || data.revisions.length === 0) {
      timelineEl.innerHTML = `
        <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
          <i class="fa-solid fa-seedling" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
          No archived revisions yet. This page is at initial version v1. Edit this page to create its first revision!
        </div>
      `;
      return;
    }

    timelineEl.innerHTML = data.revisions
      .map((rev) => {
        return `
        <div class="timeline-item">
          <div class="timeline-version-col">
            <span class="version-badge">v${rev.version}</span>
          </div>
          <div class="timeline-details">
            <div class="timeline-details-header">
              <span class="timeline-title">${escapeHtml(rev.title)}</span>
              <span class="timeline-meta"><i class="fa-regular fa-clock"></i> ${formatDate(rev.archivedAt)}</span>
            </div>
            <div class="timeline-meta" style="margin-top: 0.25rem;">
              <span><i class="fa-solid fa-user-pen"></i> ${escapeHtml(rev.changedBy || 'Anonymous')}</span>
            </div>
            <div class="timeline-actions">
              <button class="btn btn-secondary btn-sm" onclick='viewRevisionSnapshot(${JSON.stringify(rev).replace(/'/g, "&apos;")})'>
                <i class="fa-solid fa-eye"></i> View Snapshot
              </button>
              <button class="btn btn-warning btn-sm" onclick="openRollbackModal(${rev.version})">
                <i class="fa-solid fa-rotate-left"></i> Rollback to v${rev.version}
              </button>
            </div>
          </div>
        </div>
      `;
      })
      .join('');
  } catch (err) {
    timelineEl.innerHTML = `<div style="color: #ef4444; padding: 1rem;">${err.message}</div>`;
  }
}

// Modal: Open Rollback Confirmation
window.openRollbackModal = function (targetVersion) {
  if (!state.currentPage) return;
  document.getElementById('rollback-target-version').value = targetVersion;
  document.getElementById('rollback-version-display').textContent = `v${targetVersion}`;
  document.getElementById('rollback-current-version-label').textContent = `v${state.currentPage.currentVersion}`;
  document.getElementById('rollback-target-version-label').textContent = `v${targetVersion}`;
  document.getElementById('rollback-future-version-label').textContent = `v${state.currentPage.currentVersion + 1}`;
  document.getElementById('rollback-changed-by').value = '';

  closeModal('modal-history');
  openModal('modal-rollback');
};

// API: Handle Execute Rollback
async function handleExecuteRollback(e) {
  e.preventDefault();
  const version = document.getElementById('rollback-target-version').value;
  const changedBy = document.getElementById('rollback-changed-by').value.trim();

  try {
    const res = await fetch(`/api/pages/${state.currentPage.slug}/rollback/${version}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changedBy }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Rollback failed');

    closeModal('modal-rollback');
    showToast(data.message, 'success');
    await loadPages();
    selectPage(data.page.slug);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// API: Archive Page (Soft Delete)
async function archiveCurrentPage() {
  if (!state.currentPage) return;
  const confirmArchive = confirm(`Are you sure you want to archive page '${state.currentPage.title}'? It will be hidden from active views.`);
  if (!confirmArchive) return;

  try {
    const res = await fetch(`/api/pages/${state.currentPage.slug}`, {
      method: 'DELETE',
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to archive page');

    showToast(data.message, 'warning');
    await loadPages(true);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// API: Restore Archived Page
async function restoreCurrentPage() {
  if (!state.currentPage) return;

  try {
    const res = await fetch(`/api/pages/${state.currentPage.slug}/restore`, {
      method: 'PATCH',
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to restore page');

    showToast(data.message, 'success');
    await loadPages();
    selectPage(data.page.slug);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Modal: Open MongoDB Explain Stats Inspector
async function openExplainModal(slug) {
  openModal('modal-explain');
  const rawBox = document.getElementById('explain-raw-output');
  rawBox.textContent = 'Executing db.page_revisions.find().explain("executionStats")...';

  try {
    const res = await fetch(`/api/pages/${slug}/revisions/explain`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to fetch explain stats');

    const historyStats = data.historyQueryExplain?.executionStats;
    const historyPlan = data.historyQueryExplain?.winningPlan;

    // Detect stage
    let winningStage = historyPlan?.stage || 'IXSCAN';
    if (historyPlan?.inputStage?.stage) {
      winningStage = `${historyPlan.stage} -> ${historyPlan.inputStage.stage}`;
    }

    document.getElementById('stat-stage').textContent = winningStage;
    document.getElementById('stat-index').textContent = data.compoundIndex || 'pageId_1_version_-1';
    document.getElementById('stat-docs').textContent = historyStats?.totalDocsExamined ?? 0;
    document.getElementById('stat-time').textContent = `${historyStats?.executionTimeMillis ?? 0} ms`;

    rawBox.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    rawBox.textContent = `Error: ${err.message}`;
  }
}

// Trigger Seed Data
async function triggerSeedData() {
  const confirmed = confirm('Do you want to re-seed demo pages and revision history? (This will reset current wiki demo data)');
  if (!confirmed) return;

  showToast('Running seed script on MongoDB...', 'info');

  try {
    const res = await fetch('/api/seed', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to seed');

    showToast(data.message, 'success');
    await loadPages(true);
  } catch (e) {
    showToast(e.message, 'error');
  }
}
