// ─── Process Verifier: PID → path → signature ───
// Windows: GetExtendedTcpTable + QueryFullProcessImageNameW
// Linux: /proc/net/tcp + /proc/{pid}/exe

import { execSync } from 'child_process'
import { readlinkSync, readFileSync } from 'fs'
import type { ProcessInfo } from './types'

/**
 * Get the process path from a PID.
 */
function getProcessPath(pid: number): string | null {
  try {
    if (process.platform === 'win32') {
      // Use wmic or PowerShell to get process path
      const result = execSync(
        `powershell -NoProfile -Command "(Get-Process -Id ${pid}).Path"`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim()
      return result || null
    } else if (process.platform === 'linux') {
      return readlinkSync(`/proc/${pid}/exe`)
    }
  } catch {
    return null
  }
  return null
}

/**
 * Get the PID of the process connected to a given local TCP port.
 */
export function getPidFromPort(remotePort: number): number | null {
  try {
    if (process.platform === 'win32') {
      const result = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7642 -RemotePort ${remotePort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim()
      const pid = parseInt(result, 10)
      return isNaN(pid) ? null : pid
    } else if (process.platform === 'linux') {
      // Parse /proc/net/tcp
      const content = readFileSync('/proc/net/tcp', 'utf-8')
      const portHex = remotePort.toString(16).toUpperCase().padStart(4, '0')

      for (const line of content.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 10) continue

        const remoteAddr = parts[2]
        const remotePortPart = remoteAddr.split(':')[1]
        if (remotePortPart === portHex) {
          const inode = parts[9]
          // Find PID by inode
          return findPidByInode(inode)
        }
      }
    }
  } catch {
    return null
  }
  return null
}

function findPidByInode(inode: string): number | null {
  try {
    const result = execSync(
      `find /proc -maxdepth 4 -path '*/fd/*' -lname 'socket:\\[${inode}\\]' 2>/dev/null | head -1`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim()

    if (!result) return null
    const pidMatch = result.match(/\/proc\/(\d+)\//)
    return pidMatch ? parseInt(pidMatch[1], 10) : null
  } catch {
    return null
  }
}

/**
 * Verify an Authenticode signature on Windows.
 */
function verifySignature(exePath: string): { valid: boolean; hash: string | null; signerName: string | null } {
  if (process.platform !== 'win32') {
    return { valid: false, hash: null, signerName: null }
  }

  try {
    const result = execSync(
      `powershell -NoProfile -Command "$sig = Get-AuthenticodeSignature '${exePath.replace(/'/g, "''")}'; @{Status=$sig.Status.ToString(); Subject=$sig.SignerCertificate.Subject; Thumbprint=$sig.SignerCertificate.Thumbprint} | ConvertTo-Json"`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim()

    const sig = JSON.parse(result)
    const valid = sig.Status === 'Valid'
    return {
      valid,
      hash: sig.Thumbprint ? `sha256:${sig.Thumbprint.toLowerCase()}` : null,
      signerName: sig.Subject ?? null
    }
  } catch {
    return { valid: false, hash: null, signerName: null }
  }
}

/**
 * Get full process info from a PID.
 */
export function getProcessInfo(pid: number): ProcessInfo | null {
  const path = getProcessPath(pid)
  if (!path) return null

  const signature = verifySignature(path)

  return {
    pid,
    path,
    signatureHash: signature.hash,
    signatureValid: signature.valid,
    signerName: signature.signerName
  }
}

/**
 * Verify a connecting process by looking up its TCP connection.
 */
export function verifyConnectingProcess(remotePort: number): ProcessInfo | null {
  const pid = getPidFromPort(remotePort)
  if (!pid) return null
  return getProcessInfo(pid)
}
