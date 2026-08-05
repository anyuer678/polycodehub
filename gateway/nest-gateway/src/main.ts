import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { connectRedis, closeRedis } from './redis';
import { initMq, closeMq } from './mq';
import { requestIdMiddleware, rateLimiter, fail, parseError, HttpError } from './middleware';
import { dbPool } from './db';

import authRoutes from './routes/auth';
import problemRoutes from './routes/problems';
import adminRoutes from './routes/admin';
import judgeRoutes from './routes/judge';
import submissionRoutes from './routes/submissions';
import userRoutes from './routes/users';
import leaderboardRoutes from './routes/leaderboard';
import systemRoutes from './routes/system';
import infoRoutes from './routes/info';
import solutionRoutes from './routes/solutions';
import contestRoutes from './routes/contests';
import notificationRoutes from './routes/notifications';
import { settleOverdueDailyProblems } from './services/daily';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-request-id');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Max-Age', '86400');
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(requestIdMiddleware);
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  return rateLimiter(req, res, next);
});

app.use('/api/auth', authRoutes);
app.use('/api/problems', problemRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/judge', judgeRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/solutions', solutionRoutes);
app.use('/api/contests', contestRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api', infoRoutes);
app.use('/', systemRoutes);
app.use('/api', systemRoutes);

app.use((_req: Request, res: Response) => {
  fail(res, 404, 'not found');
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError && err.status < 500) {
    fail(res, err.status, err.message, err.detail);
    return;
  }
  console.error('unhandled error:', err);
  const parsed = parseError(err, 'internal server error');
  fail(res, parsed.status, parsed.message, parsed.detail);
});

async function start() {
  await connectRedis();
  await initMq();

  app.listen(config.port, () => {
    console.log(`gateway running on ${config.port}`);
  });

  setInterval(() => {
    settleOverdueDailyProblems().catch((err) => {
      console.error('daily problem settlement failed:', err);
    });
  }, 60 * 1000);
}

start().catch((err) => {
  console.error('failed to start gateway:', err);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down...`);
  try {
    await closeMq();
  } catch (err) {
    console.error('failed to close mq:', err);
  }
  try {
    await dbPool.end();
  } catch (err) {
    console.error('failed to close db pool:', err);
  }
  try {
    await closeRedis();
  } catch (err) {
    console.error('failed to close redis:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
