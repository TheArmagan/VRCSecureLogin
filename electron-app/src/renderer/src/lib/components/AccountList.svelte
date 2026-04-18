<script lang="ts">
  import AccountCard from "./AccountCard.svelte";
  import AddAccountDialog from "./AddAccountDialog.svelte";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import {
    getAccounts,
    isLoading,
    fetchAccounts,
    removeAccount,
    refreshSession,
    initAccountListeners,
  } from "$lib/state/accounts.svelte";
  import { onMount } from "svelte";

  let confirmRemoveId = $state<string | null>(null);
  let confirmRemoveOpen = $state(false);

  const accounts = $derived(getAccounts());
  const loading = $derived(isLoading());

  onMount(() => {
    fetchAccounts();
    const unsub = initAccountListeners();
    return unsub;
  });

  function handleRefresh(id: string) {
    refreshSession(id);
  }

  function handleRemove(id: string) {
    confirmRemoveId = id;
    confirmRemoveOpen = true;
  }

  async function confirmRemove() {
    if (confirmRemoveId) {
      await removeAccount(confirmRemoveId);
      confirmRemoveId = null;
      confirmRemoveOpen = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">VRChat Accounts</h2>
    <AddAccountDialog />
  </div>

  {#if loading && accounts.length === 0}
    <div class="flex flex-col gap-3">
      {#each Array(2) as _}
        <Skeleton class="h-20 w-full rounded-lg" />
      {/each}
    </div>
  {:else if accounts.length === 0}
    <div class="flex flex-col items-center gap-4 py-12 text-muted-foreground">
      <p>No accounts added yet.</p>
      <p class="text-sm">Click "Add Account" to get started.</p>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      {#each accounts as account (account.id)}
        <AccountCard
          {account}
          onrefresh={handleRefresh}
          onremove={handleRemove}
        />
      {/each}
    </div>
  {/if}
</div>

<AlertDialog.Root bind:open={confirmRemoveOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Remove Account?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the account and revoke all connected apps using it.
        This action cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmRemove}>Remove</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
