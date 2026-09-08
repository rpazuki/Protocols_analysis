/**
 * Minimal parameterized WHERE builder.
 *
 * Every value goes through a bind parameter. Nothing here interpolates
 * user input into SQL text - the only strings concatenated are fixed
 * fragments written in this repository.
 */
export class WhereBuilder {
  private readonly clauses: string[] = [];
  private readonly values: unknown[] = [];

  /** `fragment` must contain `??` where the bound value goes. */
  add(fragment: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.values.push(value);
    this.clauses.push(fragment.replace('??', `$${this.values.length}`));
    return this;
  }

  /** Adds a fragment with no bound value. */
  addRaw(fragment: string): this {
    this.clauses.push(fragment);
    return this;
  }

  /** Adds a fragment with several bound values, in order, replacing each `??`. */
  addMany(fragment: string, values: unknown[]): this {
    let out = fragment;
    for (const value of values) {
      this.values.push(value);
      out = out.replace('??', `$${this.values.length}`);
    }
    this.clauses.push(out);
    return this;
  }

  /** Reserves the next placeholder for use outside the WHERE clause (LIMIT/OFFSET). */
  bind(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  get sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  get params(): unknown[] {
    return this.values;
  }
}
