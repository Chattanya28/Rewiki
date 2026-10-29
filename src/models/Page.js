const mongoose = require('mongoose');

const PageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: [true, 'Slug is required'],
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be kebab-case (e.g. "getting-started")'],
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
    currentVersion: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'archived'],
        message: '{VALUE} is not a valid page status',
      },
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
    collection: 'pages',
  }
);

// Helpful virtual or JSON transform if needed
PageSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    delete ret.__v;
    return ret;
  },
});

const Page = mongoose.model('Page', PageSchema);

module.exports = Page;

