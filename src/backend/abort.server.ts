// Thrown inside a transaction to roll everything back and hand the caller a friendly failure.
// Returning from a transaction callback would commit whatever had been written so far.
export class Abort<F> extends Error {
  constructor(readonly failure: F) {
    super("transaction aborted");
  }
}

export const abortWith = <F>(failure: F): never => {
  throw new Abort(failure);
};
