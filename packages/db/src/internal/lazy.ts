/**
 * A value built on first use. Repositories over columns or tables added by a later migration
 * prepare their statements with it, so building the repositories on an older database (the
 * migration tests do) fails only when such a statement actually runs.
 */
export function lazy<T>(build: () => T): () => T {
  let value: T | undefined;
  let built = false;
  return () => {
    if (!built) {
      value = build();
      built = true;
    }
    return value as T;
  };
}
