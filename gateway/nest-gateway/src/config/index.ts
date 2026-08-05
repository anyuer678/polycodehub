export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface EnvConfig {
  port: number;
  authUrl: string;
  judgeUrl: string;
  selfUrl: string;
  rabbitmqMgmtUrl: string;
  redisUrl: string;
  amqpUrl: string;
  judgeQueue: string;
  allowedOrigins: string[];
  db: DbConfig;
}

function required(env: string, fallback: string): string {
  return process.env[env] || fallback;
}

function asInt(env: string, fallback: number): number {
  const value = Number(process.env[env] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`FATAL: invalid ${env} value: ${process.env[env]}`);
  }
  return value;
}

export function loadConfig(): EnvConfig {
  const config: EnvConfig = {
    port: asInt('PORT', 8080),
    authUrl: required('AUTH_SERVICE_URL', 'http://localhost:8081'),
    judgeUrl: required('JUDGE_SERVICE_URL', 'http://localhost:8082'),
    selfUrl: required('GATEWAY_URL', 'http://localhost:8080'),
    rabbitmqMgmtUrl: required('RABBITMQ_MGMT_URL', 'http://localhost:15672'),
    redisUrl: required('REDIS_URL', 'redis://localhost:6379/0'),
    amqpUrl: required('AMQP_URL', 'amqp://rabbitmq:5672'),
    judgeQueue: required('JUDGE_QUEUE', 'judge.submissions'),
    allowedOrigins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : ['http://localhost:3000'],
    db: {
      host: required('DB_HOST', 'localhost'),
      port: asInt('DB_PORT', 5432),
      database: required('DB_NAME', 'polycodehub'),
      user: required('DB_USER', 'polycode'),
      password: required('DB_PASSWORD', '')
    }
  };

  if (!config.db.password) {
    throw new Error('FATAL: DB_PASSWORD environment variable is required');
  }
  return config;
}

export const config = loadConfig();
