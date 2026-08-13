export type LifecycleAttributes = Record<
  string,
  string | number | boolean | undefined
>;

export interface LifecycleObserver {
  step<T>(
    name: string,
    attributes: LifecycleAttributes,
    operation: () => Promise<T>,
  ): Promise<T>;
  event(name: string, attributes: LifecycleAttributes): void;
}

export class NoopLifecycleObserver implements LifecycleObserver {
  async step<T>(
    _name: string,
    _attributes: LifecycleAttributes,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  event(_name: string, _attributes: LifecycleAttributes): void {}
}
