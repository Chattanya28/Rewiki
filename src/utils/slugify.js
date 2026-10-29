/**
 * Converts a raw string (e.g. page title) to a URL-safe kebab-case slug.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD') // separate accents from base letters
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric except whitespace and dash
    .replace(/[\s_-]+/g, '-') // convert spaces and underscores to single dash
    .replace(/^-+|-+$/g, ''); // strip leading/trailing dashes
}

/**
 * Validates whether a slug conforms to URL-safe kebab-case format.
 * Allowed: lowercase letters, numbers, and single hyphens between words.
 * @param {string} slug
 * @returns {boolean}
 */
function isValidSlug(slug) {
  if (typeof slug !== 'string') return false;
  const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  return slugRegex.test(slug);
}

module.exports = {
  slugify,
  isValidSlug,
};

