import { Pool } from 'pg';
import { config } from '../config';

export const dbPool = new Pool(config.db);

dbPool.on('error', (err) => {
  console.error('unexpected error on idle postgres client:', err);
});
