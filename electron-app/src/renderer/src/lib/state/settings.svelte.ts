// Settings state — Svelte 5 runes

interface Settings {
  apiPort: number
  sessionCheckIntervalMs: number
  defaultTokenTTLSeconds: number
  defaultRefreshTokenTTLDays: number
  defaultRateLimit: { rpm: number; burst: number }
  minimizeToTray: boolean
  auditLogMaxSizeMB: number
  auditLogMaxFiles: number
  autoUpdate: boolean
}

let settings = $state<Settings | null>(null)
let loading = $state(true)

export function getSettings() {
  return settings
}

export function isLoading() {
  return loading
}

export async function fetchSettings(): Promise<void> {
  loading = true
  try {
    settings = await window.vrcsl.getSettings()
  } catch (err) {
    console.error('Failed to fetch settings:', err)
  } finally {
    loading = false
  }
}

export async function updateSettings(changes: Partial<Settings>): Promise<void> {
  await window.vrcsl.updateSettings(changes)
  await fetchSettings()
}
