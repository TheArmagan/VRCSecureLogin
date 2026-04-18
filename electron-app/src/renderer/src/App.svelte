<script lang="ts">
  import { Toaster } from "$lib/components/ui/sonner";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import AccountList from "$lib/components/AccountList.svelte";
  import ConnectedApps from "$lib/components/ConnectedApps.svelte";
  import AuditLog from "$lib/components/AuditLog.svelte";
  import SettingsPanel from "$lib/components/SettingsPanel.svelte";
  import ConsentDialog from "$lib/components/ConsentDialog.svelte";
  import DeeplinkConfirmDialog from "$lib/components/DeeplinkConfirmDialog.svelte";
  import Shield from "@lucide/svelte/icons/shield";
  import Users from "@lucide/svelte/icons/users";
  import AppWindow from "@lucide/svelte/icons/app-window";
  import FileText from "@lucide/svelte/icons/file-text";
  import Settings from "@lucide/svelte/icons/settings";
  import Minus from "@lucide/svelte/icons/minus";
  import Square from "@lucide/svelte/icons/square";
  import X from "@lucide/svelte/icons/x";

  let activeTab = $state("accounts");
  let appVersion = $state("");

  $effect(() => {
    window.vrcsl.getVersion().then((v) => (appVersion = v));
  });

  const navItems = [
    { id: "accounts", label: "Accounts", icon: Users },
    { id: "apps", label: "Apps", icon: AppWindow },
    { id: "audit", label: "Audit", icon: FileText },
    { id: "settings", label: "Settings", icon: Settings },
  ] as const;
</script>

<div class="dark h-screen flex flex-col overflow-hidden bg-background">
  <!-- Top drag region with window controls -->
  <div
    class="flex items-center h-10 shrink-0 select-none border-b border-border/50"
    style="-webkit-app-region: drag"
  >
    <!-- Left: branding -->
    <div class="flex items-center gap-2.5 px-4">
      <Shield class="h-4 w-4 text-primary" />
      <span
        class="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        VRCSecureLogin
      </span>
      {#if appVersion}
        <span class="text-[10px] text-muted-foreground/50">v{appVersion}</span>
      {/if}
    </div>

    <div class="flex-1"></div>

    <!-- Right: window controls -->
    <div class="flex items-center" style="-webkit-app-region: no-drag">
      <button
        class="inline-flex items-center justify-center h-10 w-11 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
        onclick={() => window.vrcsl.windowMinimize()}
      >
        <Minus class="h-3.5 w-3.5" />
      </button>
      <button
        class="inline-flex items-center justify-center h-10 w-11 text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
        onclick={() => window.vrcsl.windowMaximize()}
      >
        <Square class="h-3 w-3" />
      </button>
      <button
        class="inline-flex items-center justify-center h-10 w-11 text-muted-foreground/70 hover:text-foreground hover:bg-destructive/80 hover:text-white transition-colors"
        onclick={() => window.vrcsl.windowClose()}
      >
        <X class="h-3.5 w-3.5" />
      </button>
    </div>
  </div>

  <!-- Main body: left nav + content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Left vertical navigation -->
    <nav
      class="flex flex-col items-center w-14 shrink-0 border-r border-border/50 bg-card/30 py-3 gap-1"
    >
      {#each navItems as item (item.id)}
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger>
              <button
                class="group relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200
                    {activeTab === item.id
                  ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}"
                onclick={() => (activeTab = item.id)}
              >
                <item.icon class="h-[18px] w-[18px]" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content side="right">
              <p>{item.label}</p>
            </Tooltip.Content>
          </Tooltip.Root>
        </Tooltip.Provider>
      {/each}

      <div class="flex-1"></div>

      <!-- Version / shield icon at bottom -->
      <div
        class="flex items-center justify-center w-10 h-10 text-muted-foreground/30"
      >
        <Shield class="h-4 w-4" />
      </div>
    </nav>

    <!-- Content area -->
    <div class="flex-1 overflow-y-auto">
      <div class="p-6 max-w-4xl">
        {#if activeTab === "accounts"}
          <AccountList />
        {:else if activeTab === "apps"}
          <ConnectedApps />
        {:else if activeTab === "audit"}
          <AuditLog />
        {:else if activeTab === "settings"}
          <SettingsPanel />
        {/if}
      </div>
    </div>
  </div>
  <ConsentDialog />
  <DeeplinkConfirmDialog />
  <Toaster />
</div>
