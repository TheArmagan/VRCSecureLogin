// ─── Scope Resolver: maps VRChat API paths to required scopes ───

// Scope hierarchy: vrchat.<category>.<action>
// Wildcards: vrchat.avatars.* matches vrchat.avatars.get, vrchat.avatars.list, etc.
// vrchat.* matches everything under vrchat

interface ScopeMapping {
  method: string
  pattern: RegExp
  scope: string
}

const SCOPE_MAPPINGS: ScopeMapping[] = [
  // Users
  { method: 'GET', pattern: /^\/users\/?$/, scope: 'vrchat.users.search' },
  { method: 'GET', pattern: /^\/users\/usr_/, scope: 'vrchat.users.get' },
  { method: 'PUT', pattern: /^\/users\/usr_[^/]+\/avatar$/, scope: 'vrchat.avatars.select' },
  { method: 'PUT', pattern: /^\/users\/usr_/, scope: 'vrchat.users.update' },

  // Friends
  { method: 'GET', pattern: /^\/auth\/user\/friends/, scope: 'vrchat.friends.list' },
  { method: 'GET', pattern: /^\/users\/usr_[^/]+\/friendStatus/, scope: 'vrchat.friends.status' },
  { method: 'POST', pattern: /^\/user\/usr_[^/]+\/friendRequest/, scope: 'vrchat.friends.create' },
  { method: 'DELETE', pattern: /^\/auth\/user\/friends\/usr_/, scope: 'vrchat.friends.delete' },

  // Avatars
  { method: 'GET', pattern: /^\/avatars\/?$/, scope: 'vrchat.avatars.list' },
  { method: 'GET', pattern: /^\/avatars\/avtr_/, scope: 'vrchat.avatars.get' },
  { method: 'POST', pattern: /^\/avatars/, scope: 'vrchat.avatars.create' },
  { method: 'PUT', pattern: /^\/avatars\/avtr_/, scope: 'vrchat.avatars.update' },
  { method: 'DELETE', pattern: /^\/avatars\/avtr_/, scope: 'vrchat.avatars.delete' },

  // Worlds
  { method: 'GET', pattern: /^\/worlds\/?$/, scope: 'vrchat.worlds.list' },
  { method: 'GET', pattern: /^\/worlds\/wrld_/, scope: 'vrchat.worlds.get' },
  { method: 'POST', pattern: /^\/worlds/, scope: 'vrchat.worlds.create' },
  { method: 'PUT', pattern: /^\/worlds\/wrld_/, scope: 'vrchat.worlds.update' },
  { method: 'DELETE', pattern: /^\/worlds\/wrld_/, scope: 'vrchat.worlds.delete' },

  // Instances
  { method: 'GET', pattern: /^\/instances\//, scope: 'vrchat.instances.get' },
  { method: 'POST', pattern: /^\/instances/, scope: 'vrchat.instances.create' },

  // Invites
  { method: 'POST', pattern: /^\/invite\/usr_/, scope: 'vrchat.invites.send' },
  { method: 'GET', pattern: /^\/messages/, scope: 'vrchat.invites.list' },

  // Favorites
  { method: 'GET', pattern: /^\/favorites/, scope: 'vrchat.favorites.list' },
  { method: 'POST', pattern: /^\/favorites/, scope: 'vrchat.favorites.create' },
  { method: 'DELETE', pattern: /^\/favorites\//, scope: 'vrchat.favorites.delete' },

  // Groups
  { method: 'GET', pattern: /^\/groups\/?$/, scope: 'vrchat.groups.list' },
  { method: 'GET', pattern: /^\/groups\/grp_/, scope: 'vrchat.groups.get' },
  { method: 'POST', pattern: /^\/groups/, scope: 'vrchat.groups.create' },
  { method: 'PUT', pattern: /^\/groups\/grp_/, scope: 'vrchat.groups.update' },
  { method: 'DELETE', pattern: /^\/groups\/grp_/, scope: 'vrchat.groups.delete' },

  // Notifications
  { method: 'GET', pattern: /^\/notifications/, scope: 'vrchat.notifications.list' },
  { method: 'PUT', pattern: /^\/notifications\//, scope: 'vrchat.notifications.update' },
  { method: 'DELETE', pattern: /^\/notifications\//, scope: 'vrchat.notifications.delete' },

  // Player Moderation
  { method: 'GET', pattern: /^\/auth\/user\/playermoderations/, scope: 'vrchat.playermod.list' },
  { method: 'POST', pattern: /^\/auth\/user\/playermoderations/, scope: 'vrchat.playermod.create' },
  { method: 'DELETE', pattern: /^\/auth\/user\/playermoderations/, scope: 'vrchat.playermod.delete' },

  // Files
  { method: 'GET', pattern: /^\/files/, scope: 'vrchat.files.get' },
  { method: 'POST', pattern: /^\/files/, scope: 'vrchat.files.create' },
  { method: 'DELETE', pattern: /^\/files\//, scope: 'vrchat.files.delete' },

  // Auth / current user (always maps to users.get for the current user)
  { method: 'GET', pattern: /^\/auth\/user$/, scope: 'vrchat.users.get' }
]

// Pipeline event to scope mapping
const EVENT_SCOPE_MAP: Record<string, string> = {
  'friend-online': 'vrchat.pipeline.friend-online',
  'friend-offline': 'vrchat.pipeline.friend-offline',
  'friend-add': 'vrchat.pipeline.friend-add',
  'friend-delete': 'vrchat.pipeline.friend-delete',
  'friend-update': 'vrchat.pipeline.friend-update',
  'friend-location': 'vrchat.pipeline.friend-location',
  'user-update': 'vrchat.pipeline.user-update',
  'user-location': 'vrchat.pipeline.user-location',
  'notification': 'vrchat.pipeline.notification',
  'notification-v2': 'vrchat.pipeline.notification',
  'see-notification': 'vrchat.pipeline.notification',
  'hide-notification': 'vrchat.pipeline.notification',
  'content-refresh': 'vrchat.pipeline.content-refresh',
  'session-refreshed': 'vrcsl.events.session',
  'session-expired': 'vrcsl.events.session',
  'account-online': 'vrcsl.events.account',
  'account-offline': 'vrcsl.events.account',
  'token-revoked': 'vrcsl.events.token',
  'token-expired': 'vrcsl.events.token'
}

// All valid scope prefixes
const VALID_SCOPE_PREFIXES = [
  'vrchat.users',
  'vrchat.friends',
  'vrchat.avatars',
  'vrchat.worlds',
  'vrchat.instances',
  'vrchat.invites',
  'vrchat.favorites',
  'vrchat.groups',
  'vrchat.notifications',
  'vrchat.playermod',
  'vrchat.files',
  'vrchat.pipeline',
  'vrcsl.events',
  'vrchat'
]

/**
 * Check if a granted scope matches a required scope.
 * E.g., 'vrchat.avatars.*' matches 'vrchat.avatars.get'
 * E.g., 'vrchat.*' matches anything under 'vrchat'
 */
export function scopeMatches(grantedScope: string, requiredScope: string): boolean {
  if (grantedScope === requiredScope) return true

  if (grantedScope.endsWith('.*')) {
    const prefix = grantedScope.slice(0, -2) // Remove .*
    return requiredScope.startsWith(prefix + '.') || requiredScope === prefix
  }

  return false
}

/**
 * Check if any of the granted scopes match the required scope.
 */
export function hasScope(grantedScopes: string[], requiredScope: string): boolean {
  return grantedScopes.some((gs) => scopeMatches(gs, requiredScope))
}

/**
 * Resolve the required scope for a VRChat API request.
 */
export function resolveApiScope(method: string, path: string): string | null {
  // Strip /api/1 prefix if present
  const cleanPath = path.replace(/^\/api\/1/, '')

  for (const mapping of SCOPE_MAPPINGS) {
    if (mapping.method === method.toUpperCase() && mapping.pattern.test(cleanPath)) {
      return mapping.scope
    }
  }

  return null
}

/**
 * Get the required scope for a pipeline event type.
 */
export function getEventScope(eventType: string): string | null {
  return EVENT_SCOPE_MAP[eventType] ?? null
}

/**
 * Check if a scope string is valid.
 */
export function isValidScope(scope: string): boolean {
  // Exact wildcard scopes
  if (scope === 'vrchat.*' || scope === 'vrcsl.events.*' || scope === 'vrchat.pipeline.*') {
    return true
  }

  // Category wildcards like vrchat.avatars.*
  if (scope.endsWith('.*')) {
    const prefix = scope.slice(0, -2)
    return VALID_SCOPE_PREFIXES.includes(prefix)
  }

  // Specific scopes: check that the prefix is valid
  const parts = scope.split('.')
  if (parts.length < 3) return false

  const prefix = parts.slice(0, 2).join('.')
  return VALID_SCOPE_PREFIXES.includes(prefix)
}

/**
 * Validate an array of scopes. Returns invalid scopes if any.
 */
export function validateScopes(scopes: string[]): { valid: boolean; invalidScopes: string[] } {
  const invalidScopes = scopes.filter((s) => !isValidScope(s))
  return { valid: invalidScopes.length === 0, invalidScopes }
}

/**
 * Get human-readable description for a scope.
 */
export function getScopeDescription(scope: string): string {
  const descriptions: Record<string, string> = {
    'vrchat.*': 'Full unrestricted VRChat API + pipeline access (DANGEROUS)',
    'vrchat.users.*': 'Full user profile access',
    'vrchat.users.get': 'Read user profiles',
    'vrchat.users.search': 'Search users',
    'vrchat.users.update': 'Update user profiles',
    'vrchat.friends.*': 'Full friends access',
    'vrchat.friends.list': 'List friends',
    'vrchat.friends.status': 'Check friend status',
    'vrchat.friends.create': 'Send friend requests',
    'vrchat.friends.delete': 'Remove friends',
    'vrchat.avatars.*': 'Full avatar access',
    'vrchat.avatars.get': 'Read avatar info',
    'vrchat.avatars.select': 'Switch avatars',
    'vrchat.avatars.list': 'List avatars',
    'vrchat.avatars.create': 'Create avatars',
    'vrchat.avatars.update': 'Update avatars',
    'vrchat.avatars.delete': 'Delete avatars',
    'vrchat.worlds.*': 'Full world access',
    'vrchat.worlds.get': 'Read world info',
    'vrchat.worlds.list': 'List worlds',
    'vrchat.instances.*': 'Full instance access',
    'vrchat.instances.get': 'Get instance info',
    'vrchat.instances.create': 'Create instances',
    'vrchat.invites.*': 'Full invite access',
    'vrchat.invites.send': 'Send invites',
    'vrchat.invites.list': 'List invites',
    'vrchat.favorites.*': 'Full favorites access',
    'vrchat.groups.*': 'Full group access',
    'vrchat.notifications.*': 'Full notification access',
    'vrchat.playermod.*': 'Player moderation access',
    'vrchat.files.*': 'File access',
    'vrchat.pipeline.*': 'All real-time pipeline events',
    'vrchat.pipeline.friend-online': 'Friend online events',
    'vrchat.pipeline.friend-offline': 'Friend offline events',
    'vrchat.pipeline.friend-add': 'Friend added events',
    'vrchat.pipeline.friend-delete': 'Friend removed events',
    'vrchat.pipeline.friend-update': 'Friend profile update events',
    'vrchat.pipeline.friend-location': 'Friend location change events',
    'vrchat.pipeline.user-update': 'Current user update events',
    'vrchat.pipeline.user-location': 'Current user location events',
    'vrchat.pipeline.notification': 'Notification events',
    'vrchat.pipeline.content-refresh': 'Content refresh events',
    'vrcsl.events.*': 'All VRCSL internal events',
    'vrcsl.events.session': 'Session state change events',
    'vrcsl.events.account': 'Account state change events',
    'vrcsl.events.token': 'Token lifecycle events'
  }

  return descriptions[scope] ?? scope
}

/**
 * Filter event types that a token with given scopes can see.
 */
export function filterPermittedEvents(
  grantedScopes: string[],
  requestedEvents?: string[]
): string[] {
  const allEvents = Object.keys(EVENT_SCOPE_MAP)
  const candidates = requestedEvents ?? allEvents

  return candidates.filter((eventType) => {
    const requiredScope = EVENT_SCOPE_MAP[eventType]
    if (!requiredScope) return false
    return hasScope(grantedScopes, requiredScope)
  })
}
