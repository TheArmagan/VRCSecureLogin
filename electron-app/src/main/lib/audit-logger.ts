// ─── Audit Logger with Log Rotation ───

import { app } from 'electron'
import { join } from 'path'
import {
  appendFileSync,
  statSync,
  renameSync,
  existsSync,
  readFileSync,
  unlinkSync
} from 'fs'
import type { AuditEventType, AuditLogEntry, AuditLogFilter, AppSettings } from './types'
import { DEFAULT_SETTINGS } from './types'

export class AuditLogger {
  private logDir: string
  private logPath: string
  private maxSizeMB: number
  private maxFiles: number

  constructor() {
    this.logDir = app.getPath('userData')
    this.logPath = join(this.logDir, 'audit.log')
    this.maxSizeMB = DEFAULT_SETTINGS.auditLogMaxSizeMB
    this.maxFiles = DEFAULT_SETTINGS.auditLogMaxFiles
  }

  updateConfig(settings: Pick<AppSettings, 'auditLogMaxSizeMB' | 'auditLogMaxFiles'>): void {
    this.maxSizeMB = settings.auditLogMaxSizeMB
    this.maxFiles = settings.auditLogMaxFiles
  }

  log(type: AuditEventType, details: Record<string, unknown>): void {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      details
    }

    const line = this.formatLogLine(entry)

    try {
      this.rotateIfNeeded()
      appendFileSync(this.logPath, line + '\n', 'utf-8')
    } catch (err) {
      console.error('Failed to write audit log:', err)
    }
  }

  private formatLogLine(entry: AuditLogEntry): string {
    const detailParts = Object.entries(entry.details)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`)
      .join(' ')
    return `[${entry.timestamp}] [${entry.type}] ${detailParts}`
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.logPath)) return

    try {
      const stat = statSync(this.logPath)
      const sizeMB = stat.size / (1024 * 1024)

      if (sizeMB >= this.maxSizeMB) {
        this.rotate()
      }
    } catch {
      // Ignore stat errors
    }
  }

  private rotate(): void {
    // Delete oldest file if it exists
    const oldestPath = join(this.logDir, `audit.log.${this.maxFiles}`)
    if (existsSync(oldestPath)) {
      unlinkSync(oldestPath)
    }

    // Shift existing rotated files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const from = join(this.logDir, `audit.log.${i}`)
      const to = join(this.logDir, `audit.log.${i + 1}`)
      if (existsSync(from)) {
        renameSync(from, to)
      }
    }

    // Rotate current log
    renameSync(this.logPath, join(this.logDir, 'audit.log.1'))
  }

  /**
   * Read audit log entries with optional filtering.
   */
  getEntries(filter?: AuditLogFilter): AuditLogEntry[] {
    const entries: AuditLogEntry[] = []

    // Read current log and rotated logs
    const files = [this.logPath]
    for (let i = 1; i <= this.maxFiles; i++) {
      const path = join(this.logDir, `audit.log.${i}`)
      if (existsSync(path)) files.push(path)
    }

    for (const file of files) {
      if (!existsSync(file)) continue
      try {
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n').filter((l) => l.trim())

        for (const line of lines) {
          const entry = this.parseLine(line)
          if (entry && this.matchesFilter(entry, filter)) {
            entries.push(entry)
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    // Apply offset and limit
    const offset = filter?.offset ?? 0
    const limit = filter?.limit ?? 100
    return entries.slice(offset, offset + limit)
  }

  private parseLine(line: string): AuditLogEntry | null {
    // Format: [timestamp] [type] key=value key="value" ...
    const match = line.match(/^\[([^\]]+)\] \[([^\]]+)\] (.*)$/)
    if (!match) return null

    const [, timestamp, type, detailStr] = match
    const details: Record<string, unknown> = {}

    // Parse key=value pairs
    const kvRegex = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g
    let kvMatch: RegExpExecArray | null
    while ((kvMatch = kvRegex.exec(detailStr)) !== null) {
      const [, key, rawValue] = kvMatch
      if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        details[key] = rawValue.slice(1, -1)
      } else if (rawValue.endsWith('ms')) {
        details[key] = rawValue
      } else if (!isNaN(Number(rawValue))) {
        details[key] = Number(rawValue)
      } else {
        details[key] = rawValue
      }
    }

    return { timestamp, type: type as AuditEventType, details }
  }

  private matchesFilter(entry: AuditLogEntry, filter?: AuditLogFilter): boolean {
    if (!filter) return true

    if (filter.types && !filter.types.includes(entry.type)) return false

    if (filter.appName && entry.details.appName !== filter.appName) return false

    if (filter.accountId && entry.details.userId !== filter.accountId) return false

    if (filter.fromDate && entry.timestamp < filter.fromDate) return false

    if (filter.toDate && entry.timestamp > filter.toDate) return false

    return true
  }
}

export const auditLogger = new AuditLogger()
