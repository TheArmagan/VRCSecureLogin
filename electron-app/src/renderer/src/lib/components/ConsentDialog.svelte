<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Badge } from "$lib/components/ui/badge";
  import { Separator } from "$lib/components/ui/separator";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import {
    getConsentRequest,
    respondToConsent,
    fetchConsentRequest,
    initConsentListeners,
  } from "$lib/state/consent.svelte";
  import { onMount } from "svelte";
  import ShieldAlert from "@lucide/svelte/icons/shield-alert";

  const request = $derived(getConsentRequest());

  let selectedScopes = $state<string[]>([]);
  let selectedAccounts = $state<string[]>([]);

  // Sync selected scopes/accounts when a new request comes in
  $effect(() => {
    if (request) {
      selectedScopes = [...request.requestedScopes];
      selectedAccounts = request.accounts.map((a) => a.id);
    }
  });

  onMount(() => {
    fetchConsentRequest();
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
    if (!request) return;
    await respondToConsent(
      request.requestId,
      true,
      selectedScopes,
      selectedAccounts,
    );
  }

  async function deny() {
    if (!request) return;
    await respondToConsent(request.requestId, false, [], []);
  }
</script>

{#if request}
  <div class="flex flex-col items-center justify-center min-h-screen p-6">
    <Card.Root class="w-full max-w-md p-6">
      <div class="flex flex-col items-center gap-4">
        <ShieldAlert class="h-12 w-12 text-primary" />
        <h2 class="text-lg font-semibold text-center">
          App Permission Request
        </h2>

        <div class="text-center">
          <p class="font-medium">{request.appName}</p>
          {#if request.appDescription}
            <p class="text-sm text-muted-foreground">
              {request.appDescription}
            </p>
          {/if}
        </div>

        <div class="flex gap-2 text-xs">
          <Badge variant="secondary">{request.signatureStatus}</Badge>
          {#if request.origin}
            <Badge variant="secondary">{request.origin}</Badge>
          {/if}
        </div>

        {#if request.processPath}
          <p class="text-xs text-muted-foreground break-all text-center">
            {request.processPath}
          </p>
        {/if}

        <Separator />

        <div class="w-full">
          <p class="text-sm font-medium mb-2">Requested Permissions</p>
          <ScrollArea class="max-h-50">
            <div class="flex flex-col gap-2">
              {#each request.requestedScopes as scope}
                <label class="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={selectedScopes.includes(scope)}
                    onCheckedChange={() => toggleScope(scope)}
                  />
                  <span class="text-sm">{scope}</span>
                </label>
              {/each}
            </div>
          </ScrollArea>
        </div>

        <Separator />

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

        <Separator />

        <div class="flex gap-3 w-full">
          <Button variant="outline" class="flex-1" onclick={deny}>Deny</Button>
          <Button
            class="flex-1"
            onclick={approve}
            disabled={selectedScopes.length === 0 ||
              selectedAccounts.length === 0}
          >
            Approve
          </Button>
        </div>
      </div>
    </Card.Root>
  </div>
{/if}
