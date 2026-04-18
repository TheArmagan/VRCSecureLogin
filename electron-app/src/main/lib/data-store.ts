// ─── AES-256-GCM Encrypted JSON File Store ───

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { credentialStore } from './credential-store'

const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

let masterKeyBuffer: Buffer | null = null

async function getMasterKey(): Promise<Buffer> {
  if (masterKeyBuffer) return masterKeyBuffer

  let keyHex = await credentialStore.getMasterKey()
  if (!keyHex) {
    const newKey = randomBytes(KEY_LENGTH)
    keyHex = newKey.toString('hex')
    await credentialStore.setMasterKey(keyHex)
  }

  masterKeyBuffer = Buffer.from(keyHex, 'hex')
  return masterKeyBuffer
}

function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, encrypted, authTag])
}

function decrypt(data: Buffer, key: Buffer): Buffer {
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short')
  }

  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH, data.length - AUTH_TAG_LENGTH)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function getDataDir(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export class DataStore<T> {
  private filePath: string
  private defaultValue: T
  private cache: T | null = null

  constructor(fileName: string, defaultValue: T) {
    this.filePath = join(getDataDir(), fileName)
    this.defaultValue = defaultValue
  }

  async read(): Promise<T> {
    if (this.cache) return this.cache

    if (!existsSync(this.filePath)) {
      this.cache = structuredClone(this.defaultValue)
      return this.cache
    }

    try {
      const key = await getMasterKey()
      const raw = readFileSync(this.filePath)
      const decrypted = decrypt(raw, key)
      this.cache = JSON.parse(decrypted.toString('utf-8'))
      return this.cache!
    } catch (err) {
      console.error(`Failed to read data store ${this.filePath}:`, err)
      this.cache = structuredClone(this.defaultValue)
      return this.cache
    }
  }

  async write(data: T): Promise<void> {
    const key = await getMasterKey()
    const json = JSON.stringify(data, null, 2)
    const encrypted = encrypt(Buffer.from(json, 'utf-8'), key)
    writeFileSync(this.filePath, encrypted)
    this.cache = data
  }

  async update(updater: (data: T) => T | void): Promise<T> {
    const current = await this.read()
    const result = updater(current)
    const updated = result ?? current
    await this.write(updated)
    return updated
  }

  invalidateCache(): void {
    this.cache = null
  }
}
