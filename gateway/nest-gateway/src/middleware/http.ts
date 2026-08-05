import { Request, Response, NextFunction, RequestHandler } from 'express';
import crypto from 'crypto';
import { z } from 'zod';

export type ApiError = {
  status: number;
  message: string;
  detail?: unknown;
};

export class HttpError extends Error {
  status: number;
  detail?: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export function ok(res: Response, data: unknown, message = 'ok', code = 0) {
  res.json({ code, message, requestId: res.locals.requestId, data });
}

export function fail(res: Response, status: number, message: string, detail?: unknown, code = status) {
  res.status(status).json({ code, message, requestId: res.locals.requestId, detail });
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('x-request-id', requestId);
  res.locals.requestId = requestId;
  next();
}

export function parseError(err: unknown, fallbackMessage: string): ApiError {
  if (err instanceof HttpError) {
    return { status: err.status, message: err.message, detail: err.detail };
  }
  const e = err as { response?: { status?: number; data?: unknown }; message?: string };
  const status = e?.response?.status || 500;
  if (status >= 500) {
    return { status, message: fallbackMessage };
  }
  return {
    status,
    message: fallbackMessage,
    detail: e?.response?.data || e?.message || 'unknown error'
  };
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function validateOrFail<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'validation failed', parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

export function parseId(raw: unknown, name: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `invalid ${name} id`);
  }
  return id;
}

export function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}
