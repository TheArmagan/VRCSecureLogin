<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import {
    getRegistrations,
    isLoading,
    fetchRegistrations,
    revokeRegistration,
  } from "$lib/state/registrations.svelte";
  import { onMount } from "svelte";
  import MoreHorizontal from "@lucide/svelte/icons/more-horizontal";
  import Shield from "@lucide/svelte/icons/shield";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  let confirmRevokeId = $state<string | null>(null);
  let confirmRevokeOpen = $state(false);

  const registrations = $derived(getRegistrations());
  const loading = $derived(isLoading());

  onMount(() => {
    fetchRegistrations();
  });

  function handleRevoke(id: string) {
    confirmRevokeId = id;
    confirmRevokeOpen = true;
  }

  async function confirmRevoke() {
    if (confirmRevokeId) {
      await revokeRegistration(confirmRevokeId);
      confirmRevokeId = null;
      confirmRevokeOpen = false;
    }
  }

  function formatDate(d: string | null): string {
    if (!d) return "Never";
    return new Date(d).toLocaleDateString();
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">Connected Apps</h2>
    <Button variant="outline" size="sm" onclick={() => fetchRegistrations()}
      >Refresh</Button
    >
  </div>

  {#if loading && registrations.length === 0}
    <Skeleton class="h-40 w-full rounded-lg" />
  {:else if registrations.length === 0}
    <Card.Root class="p-8">
      <div class="flex flex-col items-center gap-2 text-muted-foreground">
        <Shield class="h-10 w-10" />
        <p>No apps connected yet.</p>
        <p class="text-sm">
          Apps will appear here when they register via the local API.
        </p>
      </div>
    </Card.Root>
  {:else}
    <Card.Root>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>App Name</Table.Head>
            <Table.Head>Accounts</Table.Head>
            <Table.Head>Scopes</Table.Head>
            <Table.Head>Last Used</Table.Head>
            <Table.Head class="w-12"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each registrations as reg (reg.id)}
            <Table.Row>
              <Table.Cell>
                <div class="flex flex-col">
                  <span class="font-medium">{reg.appName}</span>
                  {#if reg.processPath}
                    <span
                      class="text-xs text-muted-foreground truncate max-w-50"
                    >
                      {reg.processPath}
                    </span>
                  {/if}
                </div>
              </Table.Cell>
              <Table.Cell>
                <div class="flex flex-wrap gap-1">
                  {#each reg.grantedAccountNames as name}
                    <Badge variant="secondary">{name}</Badge>
                  {/each}
                </div>
              </Table.Cell>
              <Table.Cell>
                <span class="text-sm text-muted-foreground">
                  {reg.grantedScopes.length} scope{reg.grantedScopes.length !==
                  1
                    ? "s"
                    : ""}
                </span>
              </Table.Cell>
              <Table.Cell class="text-sm text-muted-foreground">
                {formatDate(reg.lastUsedAt)}
              </Table.Cell>
              <Table.Cell>
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button {...props} variant="ghost" size="icon">
                        <MoreHorizontal class="h-4 w-4" />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item
                      onclick={() => handleRevoke(reg.id)}
                      class="text-destructive"
                    >
                      <Trash2 class="mr-2 h-4 w-4" />
                      Revoke Access
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </Card.Root>
  {/if}
</div>

<AlertDialog.Root bind:open={confirmRevokeOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Revoke App Access?</AlertDialog.Title>
      <AlertDialog.Description>
        This will immediately revoke all tokens for this app. It will need to
        re-register and request permission again.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmRevoke}>Revoke</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
