// Consent state — Svelte 5 runes

interface ConsentAccount {
  id: string
  vrchatUserId: string
  displayName: string
}

interface ConsentRequest {
  requestId: string
  appName: string
  appDescription: string
  requestedScopes: string[]
  processPath: string | null
  signatureStatus: string
  origin: string | null
  accounts: ConsentAccount[]
}

let consentRequest = $state<ConsentRequest | null>(null)

export function getConsentRequest() {
  return consentRequest
}

export async function respondToConsent(
  requestId: string,
  approved: boolean,
  grantedScopes: string[],
  grantedAccountIds: string[]
): Promise<void> {
  await window.vrcsl.respondToConsent({
    requestId,
    approved,
    grantedScopes: [...grantedScopes],
    grantedAccountIds: [...grantedAccountIds]
  })
  consentRequest = null
}

export function initConsentListeners(): () => void {
  const unsub = window.vrcsl.onConsentRequested((request) => {
    consentRequest = request as ConsentRequest
  })
  return unsub
}
