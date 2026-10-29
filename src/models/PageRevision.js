const mongoose = require('mongoose');

const PageRevisionSchema = new mongoose.Schema(
  {
    pageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Page',
      required: [true, 'pageId is required to associate revision with a page'],
      index: true,
    },
    version: {
      type: Number,
      required: [true, 'Revision version number is required'],
      min: 1,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    content: {
      type: String,
      required: [true, 'Content is required'],
    },
    archivedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    changedBy: {
      type: String,
      trim: true,
      default: 'Anonymous',
    },
  },
  {
    collection: 'page_revisions',
  }
);

// Compound index required: { pageId: 1, version: -1 }
// This optimizes both fetching all revisions of a page sorted descending,
// and fetching a specific version of a page (prefix matching + exact version match).
PageRevisionSchema.index({ pageId: 1, version: -1 });

PageRevisionSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const PageRevision = mongoose.model('PageRevision', PageRevisionSchema);

module.exports = PageRevision;

