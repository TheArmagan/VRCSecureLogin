<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Separator } from "$lib/components/ui/separator";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import {
    getDeeplinkConfirmation,
    respondToDeeplink,
    initDeeplinkListeners,
    type DeepLinkAvatarInfo,
    type DeepLinkWorldInfo,
    type DeepLinkUserInfo,
  } from "$lib/state/deeplink.svelte";
  import { onMount } from "svelte";
  import Shirt from "@lucide/svelte/icons/shirt";
  import Globe from "@lucide/svelte/icons/globe";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import Users from "@lucide/svelte/icons/users";
  import User from "@lucide/svelte/icons/user";
  import Paintbrush from "@lucide/svelte/icons/paintbrush";
  import Check from "@lucide/svelte/icons/check";

  const request = $derived(getDeeplinkConfirmation());
  const isOpen = $derived(!!request);

  let selectedAccountIdx = $state(0);

  // Sync preselected account when a new request comes in
  $effect(() => {
    if (request) {
      selectedAccountIdx = request.selectedAccountIdx;
    }
  });

  onMount(() => {
    const unsub = initDeeplinkListeners();
    return unsub;
  });

  function confirm() {
    respondToDeeplink(true, selectedAccountIdx);
  }

  function cancel() {
    respondToDeeplink(false, 0);
  }

  const actionIcons = {
    switchavatar: Shirt,
    joinworld: Globe,
    addfriend: UserPlus,
  } as const;

  const actionColors = {
    switchavatar: "text-violet-400",
    joinworld: "text-emerald-400",
    addfriend: "text-blue-400",
  } as const;
</script>

<AlertDialog.Root
  open={isOpen}
  onOpenChange={(o) => {
    if (!o) cancel();
  }}
>
  <AlertDialog.Content class="max-w-md">
    {#if request}
      {@const Icon = actionIcons[request.action]}
      <AlertDialog.Header>
        <div class="flex items-center gap-3">
          <div
            class="flex items-center justify-center w-10 h-10 rounded-full bg-muted"
          >
            <Icon class="h-5 w-5 {actionColors[request.action]}" />
          </div>
          <div>
            <AlertDialog.Title>{request.title}</AlertDialog.Title>
            <AlertDialog.Description class="text-sm text-muted-foreground">
              {request.message}
            </AlertDialog.Description>
          </div>
        </div>
      </AlertDialog.Header>

      <Separator class="my-3" />

      <!-- Rich details section -->
      {#if request.details}
        <div class="flex flex-col gap-3">
          {#if request.details.type === "avatar"}
            {@const info = request.details as DeepLinkAvatarInfo}
            <div class="flex gap-3">
              {#if info.thumbnailUrl}
                <img
                  src={info.thumbnailUrl}
                  alt={info.name ?? "Avatar"}
                  class="w-20 h-20 rounded-lg object-cover bg-muted shrink-0"
                />
              {:else}
                <div
                  class="w-20 h-20 rounded-lg bg-muted flex items-center justify-center shrink-0"
                >
                  <Paintbrush class="h-8 w-8 text-muted-foreground/40" />
                </div>
              {/if}
              <div class="flex flex-col gap-1 min-w-0">
                {#if info.name}
                  <p class="font-medium text-sm truncate">{info.name}</p>
                {:else}
                  <Skeleton class="h-4 w-32" />
                {/if}
                {#if info.authorName}
                  <div
                    class="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <User class="h-3 w-3" />
                    <span>by {info.authorName}</span>
                  </div>
                {/if}
                {#if info.description}
                  <p class="text-xs text-muted-foreground line-clamp-2">
                    {info.description}
                  </p>
                {/if}
                <Badge variant="secondary" class="w-fit text-xs mt-auto">
                  {info.avatarId.slice(0, 20)}...
                </Badge>
              </div>
            </div>
          {:else if request.details.type === "world"}
            {@const info = request.details as DeepLinkWorldInfo}
            <div class="flex gap-3">
              {#if info.thumbnailUrl}
                <img
                  src={info.thumbnailUrl}
                  alt={info.name ?? "World"}
                  class="w-24 h-16 rounded-lg object-cover bg-muted shrink-0"
                />
              {:else}
                <div
                  class="w-24 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0"
                >
                  <Globe class="h-8 w-8 text-muted-foreground/40" />
                </div>
              {/if}
              <div class="flex flex-col gap-1 min-w-0">
                {#if info.name}
                  <p class="font-medium text-sm truncate">{info.name}</p>
                {:else}
                  <Skeleton class="h-4 w-32" />
                {/if}
                {#if info.authorName}
                  <div
                    class="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <User class="h-3 w-3" />
                    <span>by {info.authorName}</span>
                  </div>
                {/if}
                {#if info.description}
                  <p class="text-xs text-muted-foreground line-clamp-2">
                    {info.description}
                  </p>
                {/if}
                <div class="flex gap-2 mt-auto">
                  {#if info.capacity !== undefined}
                    <div
                      class="flex items-center gap-1 text-xs text-muted-foreground"
                    >
                      <Users class="h-3 w-3" />
                      <span>{info.occupants ?? "?"}/{info.capacity}</span>
                    </div>
                  {/if}
                  {#if info.instanceId}
                    <Badge variant="secondary" class="text-xs"
                      >Instance: {info.instanceId.slice(0, 12)}...</Badge
                    >
                  {/if}
                </div>
              </div>
            </div>
          {:else if request.details.type === "user"}
            {@const info = request.details as DeepLinkUserInfo}
            <div class="flex gap-3">
              {#if info.thumbnailUrl}
                <img
                  src={info.thumbnailUrl}
                  alt={info.displayName ?? "User"}
                  class="w-16 h-16 rounded-full object-cover bg-muted shrink-0"
                />
              {:else}
                <div
                  class="w-16 h-16 rounded-full bg-muted flex items-center justify-center shrink-0"
                >
                  <User class="h-8 w-8 text-muted-foreground/40" />
                </div>
              {/if}
              <div class="flex flex-col gap-1 min-w-0">
                {#if info.displayName}
                  <p class="font-medium text-sm">{info.displayName}</p>
                {:else}
                  <Skeleton class="h-4 w-32" />
                {/if}
                {#if info.status}
                  <div class="flex items-center gap-1.5">
                    <span
                      class="w-2 h-2 rounded-full {info.status === 'active'
                        ? 'bg-green-400'
                        : info.status === 'join me'
                          ? 'bg-blue-400'
                          : info.status === 'ask me'
                            ? 'bg-orange-400'
                            : info.status === 'busy'
                              ? 'bg-red-400'
                              : 'bg-gray-400'}"
                    ></span>
                    <span class="text-xs text-muted-foreground capitalize"
                      >{info.status}</span
                    >
                  </div>
                {/if}
                {#if info.statusDescription}
                  <p class="text-xs text-muted-foreground italic">
                    "{info.statusDescription}"
                  </p>
                {/if}
                {#if info.bio}
                  <p class="text-xs text-muted-foreground line-clamp-2">
                    {info.bio}
                  </p>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <Separator class="my-3" />
      {/if}

      <!-- Account selection -->
      {#if request.accounts.length > 1}
        <div class="flex flex-col gap-2">
          <p class="text-sm font-medium">Perform as</p>
          <div class="flex flex-col gap-1">
            {#each request.accounts as account, idx}
              <button
                class="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left transition-colors
                  {selectedAccountIdx === idx
                  ? 'bg-primary/10 ring-1 ring-primary/30'
                  : 'hover:bg-muted/60'}"
                onclick={() => (selectedAccountIdx = idx)}
              >
                {#if account.avatarThumbnailUrl}
                  <img
                    src={account.avatarThumbnailUrl}
                    alt={account.displayName}
                    class="w-8 h-8 rounded-full object-cover bg-muted shrink-0"
                  />
                {:else}
                  <div
                    class="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0"
                  >
                    <User class="h-4 w-4 text-muted-foreground/40" />
                  </div>
                {/if}
                <span class="text-sm flex-1 truncate"
                  >{account.displayName}</span
                >
                {#if selectedAccountIdx === idx}
                  <Check class="h-4 w-4 text-primary shrink-0" />
                {/if}
              </button>
            {/each}
          </div>
        </div>
        <Separator class="my-3" />
      {:else if request.accounts.length === 1}
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Account:</span>
          {#if request.accounts[0].avatarThumbnailUrl}
            <img
              src={request.accounts[0].avatarThumbnailUrl}
              alt={request.accounts[0].displayName}
              class="w-5 h-5 rounded-full object-cover bg-muted"
            />
          {/if}
          <span class="font-medium text-foreground"
            >{request.accounts[0].displayName}</span
          >
        </div>
        <Separator class="my-3" />
      {/if}

      <AlertDialog.Footer>
        <AlertDialog.Cancel onclick={cancel}>Cancel</AlertDialog.Cancel>
        <AlertDialog.Action onclick={confirm}>Confirm</AlertDialog.Action>
      </AlertDialog.Footer>
    {/if}
  </AlertDialog.Content>
</AlertDialog.Root>
