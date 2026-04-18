<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as Table from "$lib/components/ui/table";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import {
    getEntries,
    isLoading,
    fetchAuditLog,
  } from "$lib/state/audit.svelte";
  import { onMount } from "svelte";
  import FileText from "@lucide/svelte/icons/file-text";

  let typeFilter = $state("");
  let page = $state(0);
  const PAGE_SIZE = 50;

  const entries = $derived(getEntries());
  const loading = $derived(isLoading());

  const filteredEntries = $derived(
    typeFilter
      ? entries.filter((e) =>
          e.type.toLowerCase().includes(typeFilter.toLowerCase()),
        )
      : entries,
  );

  onMount(() => {
    fetchAuditLog({ limit: 200 });
  });

  function loadMore() {
    page++;
    fetchAuditLog({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  }

  function badgeVariant(type: string): "default" | "secondary" | "destructive" {
    if (
      type.includes("denied") ||
      type.includes("revoked") ||
      type.includes("failed")
    )
      return "destructive";
    if (
      type.includes("approved") ||
      type.includes("login") ||
      type.includes("created")
    )
      return "default";
    return "secondary";
  }
</script>

<div class="flex flex-col gap-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">Audit Log</h2>
    <div class="flex items-center gap-2">
      <Input
        placeholder="Filter by type..."
        class="h-8 w-50"
        bind:value={typeFilter}
      />
      <Button
        variant="outline"
        size="sm"
        onclick={() => fetchAuditLog({ limit: 200 })}
      >
        Refresh
      </Button>
    </div>
  </div>

  {#if loading && entries.length === 0}
    <Skeleton class="h-60 w-full rounded-lg" />
  {:else if entries.length === 0}
    <Card.Root class="p-8">
      <div class="flex flex-col items-center gap-2 text-muted-foreground">
        <FileText class="h-10 w-10" />
        <p>No audit entries yet.</p>
      </div>
    </Card.Root>
  {:else}
    <Card.Root>
      <ScrollArea class="h-100">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head class="w-45">Time</Table.Head>
              <Table.Head class="w-45">Event</Table.Head>
              <Table.Head>Details</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each filteredEntries as entry (entry.timestamp + entry.type)}
              <Table.Row>
                <Table.Cell
                  class="text-xs text-muted-foreground whitespace-nowrap"
                >
                  {new Date(entry.timestamp).toLocaleString()}
                </Table.Cell>
                <Table.Cell>
                  <Badge variant={badgeVariant(entry.type)}>{entry.type}</Badge>
                </Table.Cell>
                <Table.Cell class="text-xs text-muted-foreground">
                  {#each Object.entries(entry.details) as [key, value]}
                    <span class="mr-2">
                      <span class="font-medium">{key}:</span>
                      {value}
                    </span>
                  {/each}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </ScrollArea>
    </Card.Root>

    {#if entries.length >= PAGE_SIZE}
      <div class="flex justify-center">
        <Button variant="outline" size="sm" onclick={loadMore}>Load More</Button
        >
      </div>
    {/if}
  {/if}
</div>
