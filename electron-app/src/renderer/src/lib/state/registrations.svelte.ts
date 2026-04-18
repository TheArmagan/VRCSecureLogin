// Registrations (Connected Apps) state — Svelte 5 runes

interface RegistrationView {
  id: string
  appName: string
  grantedScopes: string[]
  grantedAccountIds: string[]
  grantedAccountNames: string[]
  createdAt: string
  lastUsedAt: string | null
  processPath: string | null
  signatureHash: string | null
}

let registrations = $state<RegistrationView[]>([])
let loading = $state(true)

export function getRegistrations() {
  return registrations
}

export function isLoading() {
  return loading
}

export async function fetchRegistrations(): Promise<void> {
  loading = true
  try {
    registrations = await window.vrcsl.getRegistrations()
  } catch (err) {
    console.error('Failed to fetch registrations:', err)
  } finally {
    loading = false
  }
}

export async function updateRegistration(regId: string, changes: { grantedScopes?: string[]; grantedAccountIds?: string[] }): Promise<void> {
  await window.vrcsl.updateRegistration(regId, changes)
  await fetchRegistrations()
}

export async function revokeRegistration(regId: string): Promise<void> {
  await window.vrcsl.revokeRegistration(regId)
  await fetchRegistrations()
}
