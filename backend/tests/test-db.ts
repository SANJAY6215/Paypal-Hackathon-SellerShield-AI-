import 'dotenv/config';

/** Tests run against their own PostgreSQL database on the same server (default name: <db>_test), never the dev/prod database.
 *  Override with TEST_DATABASE_URL. The database is dropped and recreated by global-setup. */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit || process.env.DATABASE_URL;
  if (!base || !/^postgres(ql)?:\/\//.test(base)) throw new Error('Set DATABASE_URL (or TEST_DATABASE_URL) to a postgresql:// URL in backend/.env to run the tests.');
  const u = new URL(base);
  if (!explicit) u.pathname = '/' + (u.pathname.replace(/^\//, '') || 'sellershield').replace(/_test$/, '') + '_test';
  if (!/test/i.test(u.pathname)) throw new Error('Refusing to run tests: the test database name must contain "test" (it is wiped on every run).');
  return u.toString();
}
