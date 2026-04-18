// ─── OS Keychain Credential Store (keytar) ───

import keytar from 'keytar'

const SERVICE_NAME = 'vrcsl'

export class CredentialStore {
  async getMasterKey(): Promise<string | null> {
    return keytar.getPassword(SERVICE_NAME, 'master-key')
  }

  async setMasterKey(key: string): Promise<void> {
    await keytar.setPassword(SERVICE_NAME, 'master-key', key)
  }

  async getCredentials(accountId: string): Promise<{ username: string; password: string } | null> {
    const raw = await keytar.getPassword(SERVICE_NAME, `account/${accountId}`)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async setCredentials(
    accountId: string,
    username: string,
    password: string
  ): Promise<void> {
    await keytar.setPassword(
      SERVICE_NAME,
      `account/${accountId}`,
      JSON.stringify({ username, password })
    )
  }

  async deleteCredentials(accountId: string): Promise<boolean> {
    return keytar.deletePassword(SERVICE_NAME, `account/${accountId}`)
  }

  async deleteAll(): Promise<void> {
    const creds = await keytar.findCredentials(SERVICE_NAME)
    for (const cred of creds) {
      await keytar.deletePassword(SERVICE_NAME, cred.account)
    }
  }
}

export const credentialStore = new CredentialStore()
