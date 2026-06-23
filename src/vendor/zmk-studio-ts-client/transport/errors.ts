export class UserCancelledError extends Error {
    constructor(m: string, opts: ErrorOptions) {
        super(m, opts);

        // Set the prototype explicitly.
        Object.setPrototypeOf(this, UserCancelledError.prototype);
    }
}