<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Badge } from "$lib/components/ui/badge";
  import { Separator } from "$lib/components/ui/separator";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import {
    getConsentRequest,
    respondToConsent,
    initConsentListeners,
  } from "$lib/state/consent.svelte";
  import { onMount } from "svelte";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";

  const request = $derived(getConsentRequest());
  const isOpen = $derived(!!request);

  let selectedScopes = $state<string[]>([]);
  let selectedAccounts = $state<string[]>([]);
  let responding = $state(false);
  let scopeDescriptions = $state<Record<string, string>>({});

  // Sync selected scopes/accounts when a new request comes in
  $effect(() => {
    if (request) {
      selectedScopes = [...request.requestedScopes];
      selectedAccounts = request.accounts.map((a) => a.id);
      // Fetch scope descriptions (spread to plain array to avoid IPC cloning issues with reactive proxies)
      window.vrcsl
        .getScopeDescriptions([...request.requestedScopes])
        .then((descs) => {
          scopeDescriptions = descs;
        });
    }
  });

  onMount(() => {
    const unsub = initConsentListeners();
    return unsub;
  });

  function toggleScope(scope: string) {
    if (selectedScopes.includes(scope)) {
      selectedScopes = selectedScopes.filter((s) => s !== scope);
    } else {
      selectedScopes = [...selectedScopes, scope];
    }
  }

  function toggleAccount(id: string) {
    if (selectedAccounts.includes(id)) {
      selectedAccounts = selectedAccounts.filter((a) => a !== id);
    } else {
      selectedAccounts = [...selectedAccounts, id];
    }
  }

  async function approve() {
    if (!request || responding) return;
    responding = true;
    await respondToConsent(
      request.requestId,
      true,
      selectedScopes,
      selectedAccounts,
    );
    responding = false;
  }

  async function deny() {
    if (!request || responding) return;
    responding = true;
    await respondToConsent(request.requestId, false, [], []);
    responding = false;
  }
</script>

<AlertDialog.Root
  open={isOpen}
  onOpenChange={(o) => {
    if (!o && !responding) deny();
  }}
>
  <AlertDialog.Content class="max-w-md">
    {#if request}
      <AlertDialog.Header>
        <div class="flex items-center gap-3">
          <div
            class="flex items-center justify-center w-10 h-10 rounded-full bg-muted"
          >
            <ShieldAlert class="h-5 w-5 text-primary" />
          </div>
          <div>
            <AlertDialog.Title>App Permission Request</AlertDialog.Title>
            <AlertDialog.Description class="text-sm text-muted-foreground">
              <span class="font-medium text-foreground">{request.appName}</span>
              {#if request.appDescription}
                - {request.appDescription}
              {/if}
            </AlertDialog.Description>
          </div>
        </div>
      </AlertDialog.Header>

      <div class="flex gap-2 text-xs mt-2">
        <Badge variant="secondary">{request.signatureStatus}</Badge>
        {#if request.origin}
          <Badge variant="secondary">{request.origin}</Badge>
        {/if}
      </div>

      {#if request.processPath}
        <p class="text-xs text-muted-foreground break-all mt-1">
          {request.processPath}
        </p>
      {/if}

      <Separator class="my-3" />

      <div class="w-full">
        <p class="text-sm font-medium mb-2">Requested Permissions</p>
        <ScrollArea class="max-h-50">
          <div class="flex flex-col gap-2">
            {#each request.requestedScopes as scope}
              <label class="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={selectedScopes.includes(scope)}
                  onCheckedChange={() => toggleScope(scope)}
                  class="mt-0.5"
                />
                <div class="flex flex-col">
                  <span class="text-sm font-mono">{scope}</span>
                  {#if scopeDescriptions[scope] && scopeDescriptions[scope] !== scope}
                    <span class="text-xs text-muted-foreground"
                      >{scopeDescriptions[scope]}</span
                    >
                  {/if}
                </div>
              </label>
            {/each}
          </div>
        </ScrollArea>
      </div>

      <Separator class="my-3" />

      <div class="w-full">
        <p class="text-sm font-medium mb-2">Grant Access To</p>
        <div class="flex flex-col gap-2">
          {#each request.accounts as account}
            <label class="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={selectedAccounts.includes(account.id)}
                onCheckedChange={() => toggleAccount(account.id)}
              />
              <span class="text-sm">{account.displayName}</span>
            </label>
          {/each}
        </div>
      </div>

      <AlertDialog.Footer class="mt-4">
        <AlertDialog.Cancel onclick={deny}>Deny</AlertDialog.Cancel>
        <AlertDialog.Action
          onclick={approve}
          disabled={selectedScopes.length === 0 ||
            selectedAccounts.length === 0}
        >
          Approve
        </AlertDialog.Action>
      </AlertDialog.Footer>
    {/if}
  </AlertDialog.Content>
</AlertDialog.Root>
