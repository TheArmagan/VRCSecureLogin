<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as InputOTP from "$lib/components/ui/input-otp";
  import { addAccount, submitTwoFactor } from "$lib/state/accounts.svelte";

  let open = $state(false);
  let username = $state("");
  let password = $state("");
  let error = $state("");
  let submitting = $state(false);

  // 2FA state
  let twoFactorAccountId = $state<string | null>(null);
  let twoFactorCode = $state("");

  async function handleSubmit() {
    if (!username || !password) {
      error = "Username and password are required.";
      return;
    }
    submitting = true;
    error = "";
    try {
      const result = await addAccount(username, password);
      if (result.requiresTwoFactor && result.accountId) {
        twoFactorAccountId = result.accountId;
      } else if (result.success) {
        resetAndClose();
      } else {
        error = result.error ?? "Failed to add account.";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Unexpected error.";
    } finally {
      submitting = false;
    }
  }

  async function handleTwoFactor() {
    if (!twoFactorAccountId || twoFactorCode.length < 6) return;
    submitting = true;
    error = "";
    try {
      const result = await submitTwoFactor(twoFactorAccountId, twoFactorCode);
      if (result.success) {
        resetAndClose();
      } else {
        error = result.error ?? "Invalid 2FA code.";
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Unexpected error.";
    } finally {
      submitting = false;
    }
  }

  function resetAndClose() {
    username = "";
    password = "";
    error = "";
    twoFactorAccountId = null;
    twoFactorCode = "";
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Trigger>
    {#snippet child({ props })}
      <Button {...props}>Add Account</Button>
    {/snippet}
  </Dialog.Trigger>
  <Dialog.Content class="sm:max-w-106.25">
    <Dialog.Header>
      <Dialog.Title>
        {twoFactorAccountId
          ? "Two-Factor Authentication"
          : "Add VRChat Account"}
      </Dialog.Title>
      <Dialog.Description>
        {twoFactorAccountId
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter your VRChat credentials. They are stored encrypted in your OS keychain."}
      </Dialog.Description>
    </Dialog.Header>

    {#if error}
      <p class="text-sm text-destructive">{error}</p>
    {/if}

    {#if twoFactorAccountId}
      <div class="flex flex-col items-center gap-4 py-4">
        <InputOTP.Root
          maxlength={6}
          bind:value={twoFactorCode}
          onComplete={handleTwoFactor}
        >
          {#snippet children({ cells })}
            <InputOTP.Group>
              {#each cells as cell}
                <InputOTP.Slot {cell} />
              {/each}
            </InputOTP.Group>
          {/snippet}
        </InputOTP.Root>
        <Button
          onclick={handleTwoFactor}
          disabled={submitting || twoFactorCode.length < 6}
        >
          {submitting ? "Verifying..." : "Verify"}
        </Button>
      </div>
    {:else}
      <form
        class="flex flex-col gap-4 py-4"
        onsubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <div class="flex flex-col gap-2">
          <label for="username" class="text-sm font-medium">Username</label>
          <Input
            id="username"
            bind:value={username}
            placeholder="VRChat username or email"
          />
        </div>
        <div class="flex flex-col gap-2">
          <label for="password" class="text-sm font-medium">Password</label>
          <Input
            id="password"
            type="password"
            bind:value={password}
            placeholder="Password"
          />
        </div>
        <Dialog.Footer>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign In"}
          </Button>
        </Dialog.Footer>
      </form>
    {/if}
  </Dialog.Content>
</Dialog.Root>
