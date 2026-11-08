import { execSync } from 'node:child_process';
import path from 'node:path';
import { testDatabaseUrl } from './test-db';

export default function setup() {
  // --force-reset drops and recreates every table in the (guarded, *_test) database; Prisma creates the database if it is missing
  execSync('npx prisma db push --skip-generate --force-reset --accept-data-loss', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: testDatabaseUrl() }, stdio: 'pipe' });
}
