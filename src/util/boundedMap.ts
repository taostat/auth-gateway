/**
 * A Map with a maximum size and optional expiry callback.
 * Used to bound in-memory stores (challenges, device codes) to prevent unbounded growth.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private readonly maxSize: number;
  private readonly isExpired: (value: V) => boolean;

  constructor(maxSize: number, isExpired: (value: V) => boolean) {
    super();
    this.maxSize = maxSize;
    this.isExpired = isExpired;
  }

  override set(key: K, value: V): this {
    if (this.has(key)) {
      return super.set(key, value);
    }

    if (this.size >= this.maxSize) {
      for (const [k, v] of this) {
        if (this.isExpired(v)) {
          this.delete(k);
        }
      }

      if (this.size >= this.maxSize) {
        const firstKey = this.keys().next().value;
        if (firstKey !== undefined) {
          this.delete(firstKey);
        }
      }
    }

    return super.set(key, value);
  }
}
