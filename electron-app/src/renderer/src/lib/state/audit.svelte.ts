// Audit log state — Svelte 5 runes

interface AuditEntry {
  timestamp: string
  type: string
  details: Record<string, string>
}

let entries = $state<AuditEntry[]>([])
let loading = $state(true)

export function getEntries() {
  return entries
}

export function isLoading() {
  return loading
}

export async function fetchAuditLog(filter?: {
  type?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<void> {
  loading = true
  try {
    entries = await window.vrcsl.getAuditLog(filter)
  } catch (err) {
    console.error('Failed to fetch audit log:', err)
  } finally {
    loading = false
  }
}
