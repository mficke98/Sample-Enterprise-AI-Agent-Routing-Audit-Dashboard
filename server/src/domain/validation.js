import { config, PRIORITIES } from '../config.js';

/**
 * Task ingestion validation.
 *
 * Deliberate asymmetry here: missing/blank `title` or `payload` is a 400,
 * but an UNKNOWN `type` is not. An ingestion endpoint fronting "thousands of
 * client workflows daily" should not hard-reject a task because a new document
 * category appeared upstream -- the GENERAL agent exists precisely to absorb
 * that. Unknown types are accepted and annotated with a routing_note.
 */
export function validateTaskInput(input) {
  const errors = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, errors: [{ field: 'body', message: 'Request body must be a JSON object.' }], value: null };
  }

  // --- title ---
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) {
    errors.push({ field: 'title', message: 'title is required and must be a non-empty string.' });
  } else if (title.length > config.maxTitleChars) {
    errors.push({ field: 'title', message: `title exceeds ${config.maxTitleChars} characters.` });
  }

  // --- payload ---
  const payload = typeof input.payload === 'string' ? input.payload.trim() : '';
  if (!payload) {
    errors.push({ field: 'payload', message: 'payload is required and must be a non-empty string.' });
  } else if (payload.length > config.maxPayloadChars) {
    errors.push({ field: 'payload', message: `payload exceeds ${config.maxPayloadChars} characters.` });
  }

  // --- type (permissive: unknown types route to GENERAL) ---
  let type = 'GENERAL';
  if (input.type !== undefined && input.type !== null) {
    if (typeof input.type !== 'string' || !input.type.trim()) {
      errors.push({ field: 'type', message: 'type must be a non-empty string when provided.' });
    } else {
      type = input.type.trim().toUpperCase();
    }
  }

  // --- priority (strict: a typo here silently changes queue behaviour) ---
  let priority = 'MEDIUM';
  if (input.priority !== undefined && input.priority !== null) {
    const candidate = String(input.priority).trim().toUpperCase();
    if (!PRIORITIES.includes(candidate)) {
      errors.push({
        field: 'priority',
        message: `priority must be one of ${PRIORITIES.join(', ')} (got "${input.priority}").`,
      });
    } else {
      priority = candidate;
    }
  }

  if (errors.length) return { valid: false, errors, value: null };
  return { valid: true, errors: [], value: { title, type, payload, priority } };
}
