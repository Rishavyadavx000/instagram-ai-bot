// In-memory, single-instance duplicate-event protection.
//
// IMPORTANT: this Set lives in process memory only. It resets on every
// restart and is NOT shared across multiple server instances. That's
// fine for a single Render web service instance, but if this is ever
// scaled to multiple instances (or Render's autoscaling), replace this
// with a shared store — e.g. a Redis SET with SETNX + a TTL, or a
// database table with a unique constraint on the event/message id —
// so two instances can't both reply to the same event.

const DEFAULT_MAX_SIZE = 5000;

class BoundedEventSet {
  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.ids = new Set();
    this.order = [];
  }

  has(key) {
    return this.ids.has(key);
  }

  add(key) {
    if (this.ids.has(key)) return;
    this.ids.add(key);
    this.order.push(key);
    if (this.order.length > this.maxSize) {
      const oldest = this.order.shift();
      this.ids.delete(oldest);
    }
  }

  get size() {
    return this.ids.size;
  }
}

const processedEventIds = new BoundedEventSet(DEFAULT_MAX_SIZE);

module.exports = { processedEventIds, BoundedEventSet };
