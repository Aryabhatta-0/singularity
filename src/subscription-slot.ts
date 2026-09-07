export type SubscriptionHandleLike = {
  isActive(): boolean;
  unsubscribeThen(onEnd: () => void): void;
};

type SubscriptionRecord<Key, Handle> = {
  key: Key;
  identity: string;
  handle?: Handle;
};

export class SubscriptionSlot<Key, Handle extends SubscriptionHandleLike> {
  #desired?: { key: Key; identity: string };
  #pending?: SubscriptionRecord<Key, Handle>;
  #active?: SubscriptionRecord<Key, Handle>;
  #ending = false;
  #disposed = false;
  readonly #identify: (key: Key) => string;
  readonly #open: (
    key: Key,
    onApplied: () => void,
    onError: (error: unknown) => void,
  ) => Handle;
  readonly #applied: (key: Key) => void;
  readonly #failed: (error: unknown) => void;

  constructor(
    identify: (key: Key) => string,
    open: (
      key: Key,
      onApplied: () => void,
      onError: (error: unknown) => void,
    ) => Handle,
    applied: (key: Key) => void,
    failed: (error: unknown) => void,
  ) {
    this.#identify = identify;
    this.#open = open;
    this.#applied = applied;
    this.#failed = failed;
  }

  set(key?: Key) {
    if (this.#disposed) return;
    const next = key === undefined ? undefined : { key, identity: this.#identify(key) };
    if (next?.identity === this.#desired?.identity || (!next && !this.#desired)) return;
    this.#desired = next;
    this.#reconcile();
  }

  dispose() {
    this.#disposed = true;
    this.#desired = undefined;
  }

  #reconcile() {
    if (this.#disposed || this.#pending || this.#ending) return;
    if (this.#active) {
      if (this.#active.identity === this.#desired?.identity) return;
      const active = this.#active;
      if (!active.handle?.isActive()) return;
      this.#ending = true;
      active.handle.unsubscribeThen(() => {
        if (this.#active === active) this.#active = undefined;
        this.#ending = false;
        this.#reconcile();
      });
      return;
    }
    if (!this.#desired) return;

    const record: SubscriptionRecord<Key, Handle> = { ...this.#desired };
    this.#pending = record;
    record.handle = this.#open(
      record.key,
      () => this.#onApplied(record),
      error => this.#onError(record, error),
    );
  }

  #onApplied(record: SubscriptionRecord<Key, Handle>) {
    if (this.#pending !== record || !record.handle) return;
    this.#pending = undefined;
    this.#active = record;
    if (!this.#disposed && this.#desired?.identity === record.identity) this.#applied(record.key);
    this.#reconcile();
  }

  #onError(record: SubscriptionRecord<Key, Handle>, error: unknown) {
    if (this.#pending === record) this.#pending = undefined;
    if (this.#active === record) this.#active = undefined;
    if (this.#desired?.identity === record.identity) {
      this.#desired = undefined;
      if (!this.#disposed) this.#failed(error);
    }
    this.#ending = false;
    this.#reconcile();
  }
}
