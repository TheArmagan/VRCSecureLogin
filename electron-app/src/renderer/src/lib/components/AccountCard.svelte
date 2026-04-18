<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import CircleUser from "@lucide/svelte/icons/circle-user";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  interface Account {
    id: string;
    vrchatUserId: string;
    displayName: string;
    status: string;
    avatarThumbnailUrl: string | null;
    addedAt: string;
    sessionExpiry: string | null;
  }

  let {
    account,
    onrefresh,
    onremove,
  }: {
    account: Account;
    onrefresh: (id: string) => void;
    onremove: (id: string) => void;
  } = $props();

  const statusColor = $derived(
    account.status === "online"
      ? "default"
      : account.status === "re-auth"
        ? "destructive"
        : "secondary",
  );
</script>

<Card.Root class="flex flex-row items-center gap-4 p-4">
  <div class="shrink-0">
    {#if account.avatarThumbnailUrl}
      <img
        src={account.avatarThumbnailUrl}
        alt={account.displayName}
        class="h-12 w-12 rounded-full object-cover"
      />
    {:else}
      <CircleUser class="h-12 w-12 text-muted-foreground" />
    {/if}
  </div>
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2">
      <span class="font-medium truncate">{account.displayName}</span>
      <Badge variant={statusColor}>{account.status}</Badge>
    </div>
    <p class="text-xs text-muted-foreground truncate">{account.vrchatUserId}</p>
    {#if account.sessionExpiry}
      <p class="text-xs text-muted-foreground">
        Session expires: {new Date(account.sessionExpiry).toLocaleString()}
      </p>
    {/if}
  </div>
  <div class="flex gap-1 shrink-0">
    <Button
      variant="ghost"
      size="icon"
      onclick={() => onrefresh(account.id)}
      title="Refresh session"
    >
      <RefreshCw class="h-4 w-4" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      onclick={() => onremove(account.id)}
      title="Remove account"
    >
      <Trash2 class="h-4 w-4 text-destructive" />
    </Button>
  </div>
</Card.Root>
