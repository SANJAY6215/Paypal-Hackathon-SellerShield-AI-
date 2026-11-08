/**
 * One-off copy of an existing SQLite dev.db into PostgreSQL.
 *   1. cd backend && npm run db:generate-sqlite-legacy     (generates the read-only SQLite client)
 *   2. DATABASE_URL must point at the (already schema-pushed) PostgreSQL database: npm run db:push
 *   3. npm run db:migrate-from-sqlite                       (SQLITE_PATH overrides the default ../prisma/dev.db)
 * Rows are copied in foreign-key order with skipDuplicates, so it is safe to re-run. Credentials are never printed.
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';

const sqlitePath = path.resolve(process.env.SQLITE_PATH || path.join(__dirname, '../../prisma/dev.db'));
if (!fs.existsSync(sqlitePath)) { console.error(`SQLite file not found: ${sqlitePath}`); process.exit(1); }
if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || '')) { console.error('DATABASE_URL must be a postgresql:// URL'); process.exit(1); }

async function main() {
  let Legacy: any;
  try { Legacy = require('../node_modules/.legacy-sqlite-client'); }
  catch { console.error('Legacy SQLite client missing. Run: npm run db:generate-sqlite-legacy'); process.exit(1); }
  const src = new Legacy.PrismaClient({ datasources: { db: { url: 'file:' + sqlitePath.replace(/\/g, '/') } } });
  const dst = new PrismaClient();

  // order models so that every model comes after the models it references
  const models = Prisma.dmmf.datamodel.models;
  const deps = new Map(models.map((m) => [m.name, new Set(m.fields.filter((f) => f.relationFromFields?.length && f.type !== m.name).map((f) => f.type))]));
  const order: string[] = [];
  while (order.length < models.length) {
    const next = models.find((m) => !order.includes(m.name) && [...deps.get(m.name)!].every((d) => order.includes(d)));
    if (!next) throw new Error('Cyclic model dependencies');
    order.push(next.name);
  }

  let total = 0;
  for (const name of order) {
    const model = models.find((m) => m.name === name)!;
    const delegate = name.charAt(0).toLowerCase() + name.slice(1);
    const rows: any[] = await src[delegate].findMany();
    const jsonFields = model.fields.filter((f) => f.type === 'Json').map((f) => f.name);
    const data = rows.map((r) => { for (const f of jsonFields) if (r[f] === null) r[f] = Prisma.DbNull; return r; });
    let copied = 0;
    for (let i = 0; i < data.length; i += 500) copied += (await (dst as any)[delegate].createMany({ data: data.slice(i, i + 500), skipDuplicates: true })).count;
    console.log(`${name.padEnd(20)} source ${String(rows.length).padStart(5)}  copied ${String(copied).padStart(5)}  now in postgres ${await (dst as any)[delegate].count()}`);
    total += copied;
  }
  console.log(`Done. ${total} row(s) copied.`);
  await src.$disconnect(); await dst.$disconnect();
}
main().catch((e) => { console.error(e?.message || e); process.exit(1); });
