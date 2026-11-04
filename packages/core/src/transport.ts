import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { DshOAuthProvider } from './oauth.js'

/** Remote transport: streamable HTTP, optionally OAuth or static headers. */
export interface RemoteTransportSpec {
  transport: 'streamable-http'
  url: string
  headers?: Record<string, string> | undefined
  authProvider?: DshOAuthProvider | undefined
}

/** Local transport: an MCP server spawned as a child process. */
export interface StdioTransportSpec {
  transport: 'stdio'
  command: string
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  cwd?: string | undefined
}

export type TransportSpec = RemoteTransportSpec | StdioTransportSpec

/** Names the host strips from a child environment; mirrored so behaviour matches. */
const CREDENTIAL_SHAPED = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * Child environment for a stdio server: the scrubbed parent environment plus
 * whatever the plugin configuration passes explicitly.
 *
 * Credential-shaped names are dropped deliberately — the host does the same for
 * its own MCP children, and silently forwarding them would make a plugin a
 * privilege-escalation path. Pass secrets as command arguments instead, or name
 * them explicitly in `env`.
 */
export function buildChildEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (CREDENTIAL_SHAPED.test(name) || name.startsWith('DSH_')) continue
    environment[name] = value
  }
  return { ...environment, ...(extra ?? {}) }
}

/** Build the transport for one configured server. */
export function createTransport(spec: TransportSpec): unknown {
  if (spec.transport === 'stdio') {
    return new StdioClientTransport({
      command: spec.command,
      args: spec.args ?? [],
      env: buildChildEnv(spec.env),
      ...(spec.cwd !== undefined && spec.cwd.length > 0 ? { cwd: spec.cwd } : {}),
    })
  }

  const options: Record<string, unknown> = {}
  if (spec.authProvider !== undefined) options.authProvider = spec.authProvider
  const headers = spec.headers ?? {}
  if (Object.keys(headers).length > 0) options.requestInit = { headers }
  return new StreamableHTTPClientTransport(new URL(spec.url), options)
}
