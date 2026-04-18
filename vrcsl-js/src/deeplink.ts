/** DeepLink URL generation helpers. */
export class DeepLink {
  /** Generate a switch-avatar deeplink. */
  static switchAvatar(avatarId: string, accountIdx?: number): string {
    const params = new URLSearchParams({ avatarId });
    if (accountIdx !== undefined) params.set("accountIdx", String(accountIdx));
    return `vrcsl://switchavatar?${params.toString()}`;
  }

  /** Generate a join-world deeplink. */
  static joinWorld(worldId: string, instanceId?: string, accountIdx?: number): string {
    const params = new URLSearchParams({ worldId });
    if (instanceId !== undefined) params.set("instanceId", instanceId);
    if (accountIdx !== undefined) params.set("accountIdx", String(accountIdx));
    return `vrcsl://joinworld?${params.toString()}`;
  }

  /** Generate an add-friend deeplink. */
  static addFriend(userId: string, accountIdx?: number): string {
    const params = new URLSearchParams({ userId });
    if (accountIdx !== undefined) params.set("accountIdx", String(accountIdx));
    return `vrcsl://addfriend?${params.toString()}`;
  }

  /** Generate an open-VRCSL deeplink. */
  static open(): string {
    return "vrcsl://open";
  }
}
