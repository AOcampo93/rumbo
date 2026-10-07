export type IssueCode =
  // Errors: the route is rejected.
  | 'schema'
  | 'unsupported_version'
  | 'invalid_coordinates'
  | 'too_many_points'
  | 'path_too_short'
  | 'duplicate_point_id'
  | 'invalid_order'
  | 'unknown_action'
  | 'missing_content'
  | 'content_locale_mismatch'
  // Warnings (errors only where an option says so).
  | 'overlapping_zones'
  | 'unused_action'
  | 'unknown_action_type'
  | 'challenge_single_point'
  | 'small_radius'
  | 'missing_translation'
  | 'unused_content';

export interface Issue {
  /** Where in the input, e.g. `points[3].radius`; empty for the whole document. */
  path: string;
  code: IssueCode;
  /** For developers and content authors; the UI maps `code` to its own text. */
  message: string;
}

/** Formats a path like `['points', 3, 'radius']` as `points[3].radius`. */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, key) => {
    if (typeof key === 'number') return `${out}[${key}]`;
    const name = String(key);
    return out ? `${out}.${name}` : name;
  }, '');
}
