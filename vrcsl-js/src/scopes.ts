/** Scope constants matching the parent PDR Section 8. */
export const Scopes = {
  // Users
  USERS_ALL: "vrchat.users.*",
  USERS_GET: "vrchat.users.get",
  USERS_SEARCH: "vrchat.users.search",

  // Friends
  FRIENDS_ALL: "vrchat.friends.*",
  FRIENDS_LIST: "vrchat.friends.list",
  FRIENDS_STATUS: "vrchat.friends.status",

  // Avatars
  AVATARS_ALL: "vrchat.avatars.*",
  AVATARS_GET: "vrchat.avatars.get",
  AVATARS_SELECT: "vrchat.avatars.select",
  AVATARS_LIST: "vrchat.avatars.list",

  // Worlds
  WORLDS_ALL: "vrchat.worlds.*",
  WORLDS_GET: "vrchat.worlds.get",
  WORLDS_LIST: "vrchat.worlds.list",

  // Instances
  INSTANCES_ALL: "vrchat.instances.*",
  INSTANCES_GET: "vrchat.instances.get",
  INSTANCES_CREATE: "vrchat.instances.create",

  // Invites
  INVITES_ALL: "vrchat.invites.*",
  INVITES_SEND: "vrchat.invites.send",
  INVITES_LIST: "vrchat.invites.list",

  // Favorites
  FAVORITES_ALL: "vrchat.favorites.*",

  // Groups
  GROUPS_ALL: "vrchat.groups.*",

  // Notifications
  NOTIFICATIONS_ALL: "vrchat.notifications.*",

  // Player Moderation
  PLAYERMOD_ALL: "vrchat.playermod.*",

  // Files
  FILES_ALL: "vrchat.files.*",

  // Pipeline (events)
  PIPELINE_ALL: "vrchat.pipeline.*",
  PIPELINE_FRIEND_ONLINE: "vrchat.pipeline.friend-online",
  PIPELINE_FRIEND_OFFLINE: "vrchat.pipeline.friend-offline",
  PIPELINE_FRIEND_ADD: "vrchat.pipeline.friend-add",
  PIPELINE_FRIEND_DELETE: "vrchat.pipeline.friend-delete",
  PIPELINE_FRIEND_UPDATE: "vrchat.pipeline.friend-update",
  PIPELINE_FRIEND_LOCATION: "vrchat.pipeline.friend-location",
  PIPELINE_USER_UPDATE: "vrchat.pipeline.user-update",
  PIPELINE_USER_LOCATION: "vrchat.pipeline.user-location",
  PIPELINE_NOTIFICATION: "vrchat.pipeline.notification",
  PIPELINE_CONTENT_REFRESH: "vrchat.pipeline.content-refresh",

  // VRCSL internal events
  VRCSL_EVENTS_ALL: "vrcsl.events.*",
  VRCSL_EVENTS_SESSION: "vrcsl.events.session",
  VRCSL_EVENTS_ACCOUNT: "vrcsl.events.account",
  VRCSL_EVENTS_TOKEN: "vrcsl.events.token",

  // Full access
  VRCHAT_ALL: "vrchat.*",
} as const;
