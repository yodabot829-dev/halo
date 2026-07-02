import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type CallStatus = 'ok' | 'error' | 'cancelled'

export interface CallRecord {
  provider: string
  model: string
  taskClass: string
  inputTokens: number
  outputTokens: number
  ok: boolean
  status?: CallStatus
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
    // Additive migration for pre-status databases.
    const cols = this.db.prepare('PRAGMA table_info(calls)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'status')) {
      this.db.exec("ALTER TABLE calls ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'")
    }
  }

  record(call: CallRecord, ts = Date.now()): void {
    const status: CallStatus = call.status ?? (call.ok ? 'ok' : 'error')
    this.db
      .prepare(
        `INSERT INTO calls (ts, provider, model, task_class, input_tokens, output_tokens, ok, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ts,
        call.provider,
        call.model,
        call.taskClass,
        call.inputTokens,
        call.outputTokens,
        call.ok ? 1 : 0,
        status,
      )
  }

  /** Total tokens (in+out) per provider since a timestamp — budget burn. */
  tokensSince(sinceTs: number): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT provider, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
         FROM calls WHERE ts >= ? GROUP BY provider`,
      )
      .all(sinceTs) as { provider: string; tokens: number }[]
    return new Map(rows.map((r) => [r.provider, r.tokens]))
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
