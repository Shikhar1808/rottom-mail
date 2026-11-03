/** An error with an HTTP status; the error handler in app.ts sends it as { error: message, code? }. `code` lets the UI react to one case. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
