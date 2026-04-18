// Deep link confirmation state — Svelte 5 runes

export interface DeepLinkAvatarInfo {
  type: 'avatar'
  avatarId: string
  name?: string
  description?: string
  thumbnailUrl?: string
  authorName?: string
}

export interface DeepLinkWorldInfo {
  type: 'world'
  worldId: string
  instanceId?: string
  name?: string
  description?: string
  thumbnailUrl?: string
  authorName?: string
  capacity?: number
  occupants?: number
}

export interface DeepLinkUserInfo {
  type: 'user'
  userId: string
  displayName?: string
  bio?: string
  thumbnailUrl?: string
  status?: string
  statusDescription?: string
}

export interface DeepLinkConfirmationAccount {
  id: string
  displayName: string
  avatarThumbnailUrl?: string
}

export interface DeepLinkConfirmationRequest {
  id: string
  action: 'switchavatar' | 'joinworld' | 'addfriend'
  title: string
  message: string
  details: DeepLinkAvatarInfo | DeepLinkWorldInfo | DeepLinkUserInfo | null
  accounts: DeepLinkConfirmationAccount[]
  selectedAccountIdx: number
}

let confirmationRequest = $state<DeepLinkConfirmationRequest | null>(null)

export function getDeeplinkConfirmation() {
  return confirmationRequest
}

export function respondToDeeplink(confirmed: boolean, selectedAccountIdx: number): void {
  window.vrcsl.sendDeeplinkConfirmationResult(confirmed, selectedAccountIdx)
  confirmationRequest = null
}

export function initDeeplinkListeners(): () => void {
  const unsub = window.vrcsl.onDeeplinkConfirmation((request) => {
    confirmationRequest = request as DeepLinkConfirmationRequest
  })
  return unsub
}
