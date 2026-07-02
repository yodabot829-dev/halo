import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface CallRecord {
  provider: string
  model: string
  taskClass: string
  inputTokens: number
  outputTokens: number
  ok: boolean
}

export interface ProviderTotals {
  provider: string
  calls: number
  inputTokens: number
  outputTokens: number
}

/**
 * Token ledger — every model call is recorded here. Budget burn-down
 * (slice 3) is computed from this table; nothing else writes usage.
 */
export class Meter {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        task_class TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        ok INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_calls_provider_ts ON calls(provider, ts);
    `)
  }

  record(call: CallRecord, ts = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO calls (ts, provider, model, task_class, input_tokens, output_tokens, ok)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ts, call.provider, call.model, call.taskClass, call.inputTokens, call.outputTokens, call.ok ? 1 : 0)
  }

  totals(sinceTs = 0): ProviderTotals[] {
    return this.db
      .prepare(
        `SELECT provider,
                COUNT(*) AS calls,
                COALESCE(SUM(input_tokens), 0) AS inputTokens,
                COALESCE(SUM(output_tokens), 0) AS outputTokens
         FROM calls WHERE ts >= ? GROUP BY provider ORDER BY provider`,
      )
      .all(sinceTs) as ProviderTotals[]
  }

  close(): void {
    this.db.close()
  }
}
