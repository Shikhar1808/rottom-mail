/** An error with an HTTP status; the error handler in app.ts sends it to the client as { error: message }. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
