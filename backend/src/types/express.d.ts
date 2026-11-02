// Adds req.userId (set by middleware/requireAuth) to Express's Request type.
export {};

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}
