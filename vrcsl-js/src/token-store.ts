/** Token storage adapters for vrcsl.js SDK. */

export interface TokenStore {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

/** In-memory token store (non-persistent). */
export class MemoryStore implements TokenStore {
  private store = new Map<string, string>();

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  remove(key: string): void {
    this.store.delete(key);
  }
}

/** localStorage-based token store (browser, persistent). */
export class LocalStorageStore implements TokenStore {
  get(key: string): string | null {
    return localStorage.getItem(key);
  }

  set(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }
}

/** JSON file-based token store (Node.js/Bun, persistent). */
export class JsonFileStore implements TokenStore {
  private filePath: string;

  constructor(path?: string) {
    this.filePath = path ?? "./vrcsl-tokens.json";
  }

  async get(key: string): Promise<string | null> {
    try {
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(this.filePath, "utf-8");
      const data = JSON.parse(content);
      return data[key] ?? null;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    const { readFile, writeFile, rename } = await import("node:fs/promises");
    let data: Record<string, string> = {};
    try {
      const content = await readFile(this.filePath, "utf-8");
      data = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
    data[key] = value;
    const tmpPath = this.filePath + ".tmp";
    await writeFile(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmpPath, this.filePath);
  }

  async remove(key: string): Promise<void> {
    const { readFile, writeFile, rename, unlink } = await import("node:fs/promises");
    let data: Record<string, string> = {};
    try {
      const content = await readFile(this.filePath, "utf-8");
      data = JSON.parse(content);
    } catch {
      return;
    }
    delete data[key];
    if (Object.keys(data).length === 0) {
      try {
        await unlink(this.filePath);
      } catch {
        // Ignore if file already deleted
      }
    } else {
      const tmpPath = this.filePath + ".tmp";
      await writeFile(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
      await rename(tmpPath, this.filePath);
    }
  }
}

/** Detect the appropriate default token store for the current runtime. */
export function getDefaultTokenStore(): TokenStore {
  // Browser environment
  if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
    return new LocalStorageStore();
  }
  // Node.js / Bun environment
  return new JsonFileStore();
}
