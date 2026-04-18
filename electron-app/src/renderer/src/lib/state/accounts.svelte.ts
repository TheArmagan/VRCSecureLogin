// Accounts state — Svelte 5 runes

interface AccountView {
  id: string
  vrchatUserId: string
  displayName: string
  status: string
  avatarThumbnailUrl: string | null
  addedAt: string
  sessionExpiry: string | null
}

let accounts = $state<AccountView[]>([])
let loading = $state(true)

export function getAccounts() {
  return accounts
}

export function isLoading() {
  return loading
}

export async function fetchAccounts(): Promise<void> {
  loading = true
  try {
    accounts = await window.vrcsl.getAccounts()
  } catch (err) {
    console.error('Failed to fetch accounts:', err)
  } finally {
    loading = false
  }
}

export async function addAccount(username: string, password: string) {
  const result = await window.vrcsl.addAccount({ username, password })
  if (result.success && !result.requiresTwoFactor) {
    await fetchAccounts()
  }
  return result
}

export async function submitTwoFactor(accountId: string, code: string) {
  const result = await window.vrcsl.submitTwoFactor(accountId, code)
  if (result.success) {
    await fetchAccounts()
  }
  return result
}

export async function removeAccount(accountId: string): Promise<void> {
  await window.vrcsl.removeAccount(accountId)
  await fetchAccounts()
}

export async function refreshSession(accountId: string): Promise<boolean> {
  const ok = await window.vrcsl.refreshSession(accountId)
  await fetchAccounts()
  return ok
}

// Listen for status change events from main process
export function initAccountListeners(): () => void {
  const unsub = window.vrcsl.onAccountStatusChanged((_accountId, _status) => {
    fetchAccounts()
  })
  return unsub
}
