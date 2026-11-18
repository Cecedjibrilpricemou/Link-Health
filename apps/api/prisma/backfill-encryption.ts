// One-time migration: encrypts sensitive fields on rows written before
// field-level encryption (config/prisma-encryption.extension.ts) existed.
//
// Defaults to a dry run — pass --apply to actually write changes. Safe to
// re-run: rows already carrying the 'enc:v1:' prefix are left untouched, so
// an interrupted or repeated run just picks up where it left off.
//
// Usage:
//   npx tsx prisma/backfill-encryption.ts                 # dry run
//   npx tsx prisma/backfill-encryption.ts --apply          # write changes
//   npx tsx prisma/backfill-encryption.ts --apply --batch-size=500
//   npx tsx prisma/backfill-encryption.ts --model=PersonneAssuree --apply
//
// Recommended: run during low-traffic hours. Rows written by the live app
// concurrently with this script are not protected against being raced — the
// app always writes already-encrypted values, so the worst case is this
// script re-reading a row before/after a concurrent edit, never data loss.

import 'dotenv/config';
import { PrismaClient } from '../src/config/generated/client/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { EMPREINTES, ENCRYPTED_FIELDS, FieldMap } from '../src/config/prisma-encryption.extension';
import { decryptField, empreinteRecherche, encryptArray, encryptField } from '../src/utils/encryption.utils';

const ENC_PREFIX = 'enc:v1:';
const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = Number(process.argv.find((a) => a.startsWith('--batch-size='))?.split('=')[1]) || 200;
const MODEL_FILTER = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1];
if (MODEL_FILTER && !Object.prototype.hasOwnProperty.call(ENCRYPTED_FIELDS, MODEL_FILTER)) {
  throw new Error(`Unknown encrypted model: ${MODEL_FILTER}`);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
// Deliberately the raw client (no withFieldEncryption): reading through the
// encrypting extension would auto-decrypt already-migrated rows back to
// plaintext, making it impossible to tell which rows still need migrating.
const prisma = new PrismaClient({ adapter });

function needsEncryption(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith(ENC_PREFIX);
}

function arrayNeedsEncryption(value: unknown): boolean {
  return Array.isArray(value) && value.some((v) => needsEncryption(v));
}

interface Totals {
  scanned: number;
  updated: number;
  fieldsEncrypted: number;
}

async function backfillModel(modelName: string, map: FieldMap): Promise<Totals> {
  const accessor = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[accessor];
  if (!delegate) throw new Error(`Unknown Prisma model accessor: ${accessor}`);

  const totals: Totals = { scanned: 0, updated: 0, fieldsEncrypted: 0 };
  const select: Record<string, boolean> = { id: true };
  for (const field of [...map.scalar, ...map.array]) select[field] = true;
  // R4 : les empreintes de recherche (EMPREINTES) se posent dans le meme
  // passage, depuis la valeur en clair - chiffree ou non, on la lit d'abord.
  const empreintes = EMPREINTES[modelName] ?? {};
  for (const colonne of Object.values(empreintes)) select[colonne] = true;

  let cursor: string | undefined;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = await delegate.findMany({
      select,
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      totals.scanned += 1;
      const data: Record<string, unknown> = {};

      for (const [champ, colonne] of Object.entries(empreintes)) {
        const clair = typeof row[champ] === 'string' ? decryptField(row[champ] as string) : null;
        const attendue = empreinteRecherche(clair);
        if (row[colonne] !== attendue) data[colonne] = attendue;
      }

      for (const field of map.scalar) {
        if (needsEncryption(row[field])) {
          data[field] = encryptField(row[field]);
          totals.fieldsEncrypted += 1;
        }
      }
      for (const field of map.array) {
        if (arrayNeedsEncryption(row[field])) {
          data[field] = encryptArray(row[field]);
          totals.fieldsEncrypted += 1;
        }
      }

      if (Object.keys(data).length > 0) {
        totals.updated += 1;
        if (APPLY) {
          await delegate.update({ where: { id: row.id }, data });
        }
      }
    }

    cursor = rows[rows.length - 1].id;
    const isLastBatch = rows.length < BATCH_SIZE;
    if (!isLastBatch) {
      console.log(
        `[${modelName}] ... scanned ${totals.scanned}, ${totals.updated} row(s) ${APPLY ? 'encrypted' : 'would be encrypted'} so far`
      );
    }
    if (isLastBatch) break;
  }

  console.log(
    `[${modelName}] done — scanned ${totals.scanned}, ${totals.updated} row(s) ${APPLY ? 'encrypted' : 'would be encrypted'}`
  );
  return totals;
}

async function main() {
  console.log(
    `Encryption backfill${MODEL_FILTER ? ` — model: ${MODEL_FILTER}` : ''} — mode: ${APPLY ? 'APPLY (writing to DB)' : 'DRY RUN (no writes)'}`
  );
  if (!APPLY) {
    console.log('Pass --apply to write changes. Safe to re-run; already-encrypted rows are skipped.\n');
  }

  const grand: Totals = { scanned: 0, updated: 0, fieldsEncrypted: 0 };

  const models = Object.entries(ENCRYPTED_FIELDS).filter(([modelName]) => !MODEL_FILTER || modelName === MODEL_FILTER);
  for (const [modelName, map] of models) {
    const totals = await backfillModel(modelName, map);
    grand.scanned += totals.scanned;
    grand.updated += totals.updated;
    grand.fieldsEncrypted += totals.fieldsEncrypted;
  }

  console.log('\n=== Summary ===');
  console.log(`Rows scanned:                                ${grand.scanned}`);
  console.log(`Rows ${APPLY ? 'updated' : 'that would be updated'}:${' '.repeat(APPLY ? 17 : 1)}${grand.updated}`);
  console.log(`Field values ${APPLY ? 'encrypted' : 'that would be encrypted'}:${' '.repeat(APPLY ? 8 : 1)}${grand.fieldsEncrypted}`);

  if (!APPLY && grand.updated > 0) {
    console.log('\nRe-run with --apply to write these changes.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
