// LMS adapters. Each adapter exposes the same shape (see canvas.js); add another
// platform by writing its adapter and listing it here.
import { canvas } from './canvas.js';

export const ADAPTERS = [canvas];

/** The adapter and course a page address belongs to, or null. */
export function detectCourse(url) {
  for (const adapter of ADAPTERS) {
    const course = adapter.matchCourse(url);
    if (course) return { adapter, course };
  }
  return null;
}
