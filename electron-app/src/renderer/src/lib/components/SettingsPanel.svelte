<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import { Separator } from "$lib/components/ui/separator";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import {
    getSettings,
    isLoading,
    fetchSettings,
    updateSettings,
  } from "$lib/state/settings.svelte";
  import { onMount } from "svelte";

  const settings = $derived(getSettings());
  const loading = $derived(isLoading());

  let localPort = $state(7642);
  let localRpm = $state(60);
  let localBurst = $state(10);
  let localCheckInterval = $state(300000);
  let localTokenTTL = $state(3600);
  let localRefreshTTL = $state(30);
  let localMaxSizeMB = $state(50);
  let localMaxFiles = $state(5);

  // Sync local state when settings load
  $effect(() => {
    if (settings) {
      localPort = settings.apiPort;
      localRpm = settings.defaultRateLimit.rpm;
      localBurst = settings.defaultRateLimit.burst;
      localCheckInterval = settings.sessionCheckIntervalMs;
      localTokenTTL = settings.defaultTokenTTLSeconds;
      localRefreshTTL = settings.defaultRefreshTokenTTLDays;
      localMaxSizeMB = settings.auditLogMaxSizeMB;
      localMaxFiles = settings.auditLogMaxFiles;
    }
  });

  onMount(() => {
    fetchSettings();
  });

  async function handleToggle(key: string, value: boolean) {
    await updateSettings({ [key]: value });
  }

  async function saveAdvanced() {
    await updateSettings({
      apiPort: localPort,
      defaultRateLimit: { rpm: localRpm, burst: localBurst },
      sessionCheckIntervalMs: localCheckInterval,
      defaultTokenTTLSeconds: localTokenTTL,
      defaultRefreshTokenTTLDays: localRefreshTTL,
      auditLogMaxSizeMB: localMaxSizeMB,
      auditLogMaxFiles: localMaxFiles,
    });
  }
</script>

<div class="flex flex-col gap-4">
  <h2 class="text-lg font-semibold">Settings</h2>

  {#if loading || !settings}
    <div class="flex flex-col gap-3">
      {#each Array(4) as _}
        <Skeleton class="h-12 w-full rounded-lg" />
      {/each}
    </div>
  {:else}
    <Card.Root class="p-4">
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">Minimize to Tray</p>
            <p class="text-xs text-muted-foreground">
              Keep running in system tray when closed
            </p>
          </div>
          <Switch
            checked={settings.minimizeToTray}
            onCheckedChange={(v) => handleToggle("minimizeToTray", v)}
          />
        </div>

        <Separator />

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium">Auto Update</p>
            <p class="text-xs text-muted-foreground">
              Check for updates automatically
            </p>
          </div>
          <Switch
            checked={settings.autoUpdate}
            onCheckedChange={(v) => handleToggle("autoUpdate", v)}
          />
        </div>
      </div>
    </Card.Root>

    <Card.Root class="p-4">
      <div class="flex flex-col gap-4">
        <h3 class="text-sm font-semibold">Advanced</h3>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-1">
            <label for="apiPort" class="text-xs font-medium">API Port</label>
            <Input
              id="apiPort"
              type="number"
              bind:value={localPort}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="checkInterval" class="text-xs font-medium"
              >Session Check (ms)</label
            >
            <Input
              id="checkInterval"
              type="number"
              bind:value={localCheckInterval}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="rateRpm" class="text-xs font-medium"
              >Rate Limit (per min)</label
            >
            <Input
              id="rateRpm"
              type="number"
              bind:value={localRpm}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="rateBurst" class="text-xs font-medium"
              >Burst (per sec)</label
            >
            <Input
              id="rateBurst"
              type="number"
              bind:value={localBurst}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="tokenTTL" class="text-xs font-medium"
              >Token TTL (seconds)</label
            >
            <Input
              id="tokenTTL"
              type="number"
              bind:value={localTokenTTL}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="refreshTTL" class="text-xs font-medium"
              >Refresh TTL (days)</label
            >
            <Input
              id="refreshTTL"
              type="number"
              bind:value={localRefreshTTL}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="maxSizeMB" class="text-xs font-medium"
              >Max Log Size (MB)</label
            >
            <Input
              id="maxSizeMB"
              type="number"
              bind:value={localMaxSizeMB}
              class="h-8"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="maxFiles" class="text-xs font-medium"
              >Max Log Files</label
            >
            <Input
              id="maxFiles"
              type="number"
              bind:value={localMaxFiles}
              class="h-8"
            />
          </div>
        </div>

        <div class="flex justify-end">
          <Button size="sm" onclick={saveAdvanced}>Save</Button>
        </div>
      </div>
    </Card.Root>
  {/if}
</div>
