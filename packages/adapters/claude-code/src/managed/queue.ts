/**
 * An unbounded single-consumer async queue. Used twice per agent: as the SDK's streaming input
 * (owner/lead messages flow in) and as the adapter's event stream (events flow out). Pushing after
 * `close()` is a no-op that returns false, so callers can tell a late push from a delivered one.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiter: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;
  private iterating = false;

  get isClosed(): boolean {
    return this.closed;
  }

  push(item: T): boolean {
    if (this.closed) return false;
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
    return true;
  }

  /** Ends the stream after the items already queued have been read. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter !== null) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    // Two consumers would each see an arbitrary half of the stream; fail loudly instead.
    if (this.iterating) throw new Error('AsyncQueue supports a single consumer');
    this.iterating = true;
    return {
      next: () => {
        if (this.items.length > 0) {
          // The length check above makes the shift non-empty.
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
      return: () => {
        this.close();
        this.items.length = 0;
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
