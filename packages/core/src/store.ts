import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { OAuthClientProvider } from '@modelcontextprotocol/client'

/** Token set as the MCP SDK's provider interface describes it. */
export type Tokens = NonNullable<Awaited<ReturnType<OAuthClientProvider['tokens']>>>
/** Registered-client information as the MCP SDK's provider interface describes it. */
export type ClientInformation = NonNullable<
  Awaited<ReturnType<OAuthClientProvider['clientInformation']>>
>
/** Per-authorization-server context the SDK passes to credential callbacks. */
export type IssuerContext = Parameters<OAuthClientProvider['tokens']>[0]

interface IssuerEntry {
  client?: ClientInformation
  tokens?: Tokens
}

interface StoreState {
  version: 1
  lastIssuer?: string
  issuers: Record<string, IssuerEntry>
}

/** Key used when the SDK asks for tokens without naming an authorization server. */
const LAST_ISSUER = '*'

/**
 * Root of the DeepSeek Harness installation that owns this process.
 *
 * Matches the host's own convention so a plugin running under the desktop app
 * and one running under the CLI resolve to the same directory.
 */
export function dshHome(): string {
  const configured = process.env.DSH_HOME?.trim()
  return configured && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * Persistent OAuth credentials for one MCP server.
 *
 * One JSON document per server under `$DSH_HOME/mcp-oauth/`, written atomically
 * and chmod 0600. Entries are keyed by authorization-server issuer so a server
 * that moves between issuers never replays a token against the wrong one
 * (RFC 9207 mix-up defense).
 */
export class TokenStore {
  /** Absolute path of the backing file; surfaced in logs so users can find it. */
  readonly file: string

  #state: StoreState | undefined

  constructor(serverName: string) {
    this.file = join(dshHome(), 'mcp-oauth', `${serverName}.json`)
  }

  async #load(): Promise<StoreState> {
    if (this.#state !== undefined) return this.#state
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoreState>
      this.#state = {
        version: 1,
        ...(typeof raw.lastIssuer === 'string' ? { lastIssuer: raw.lastIssuer } : {}),
        issuers: raw.issuers ?? {},
      }
    } catch {
      this.#state = { version: 1, issuers: {} }
    }
    return this.#state
  }

  #key(ctx: IssuerContext): string {
    return ctx?.issuer && ctx.issuer.length > 0 ? ctx.issuer : LAST_ISSUER
  }

  async #flush(): Promise<void> {
    const state = await this.#load()
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, this.file)
    if (process.platform !== 'win32') await chmod(this.file, 0o600).catch(() => {})
  }

  /** Stored client registration for an issuer, or `undefined` when unregistered. */
  async client(ctx?: IssuerContext): Promise<ClientInformation | undefined> {
    const state = await this.#load()
    const entry = state.issuers[this.#key(ctx)]
    return entry?.client
  }

  /** Persist a dynamically registered client and remember it as the latest issuer. */
  async putClient(ctx: IssuerContext | undefined, client: ClientInformation): Promise<void> {
    const state = await this.#load()
    const key = this.#key(ctx)
    state.issuers[key] = { ...state.issuers[key], client }
    if (key !== LAST_ISSUER) state.lastIssuer = key
    await this.#flush()
  }

  /**
   * Tokens for an issuer, or the most recently saved set when the SDK asks
   * without context (its per-request bearer-token read).
   */
  async tokens(ctx?: IssuerContext): Promise<Tokens | undefined> {
    const state = await this.#load()
    const direct = state.issuers[this.#key(ctx)]?.tokens
    if (direct !== undefined) return direct
    if (ctx?.issuer) return undefined
    const latest = state.lastIssuer !== undefined ? state.issuers[state.lastIssuer]?.tokens : undefined
    if (latest !== undefined) return latest
    for (const entry of Object.values(state.issuers)) {
      if (entry.tokens !== undefined) return entry.tokens
    }
    return undefined
  }

  /** Persist a token set for an issuer. */
  async putTokens(ctx: IssuerContext | undefined, tokens: Tokens): Promise<void> {
    const state = await this.#load()
    const key = this.#key(ctx)
    state.issuers[key] = { ...state.issuers[key], tokens }
    if (key !== LAST_ISSUER) state.lastIssuer = key
    await this.#flush()
  }

  /** Drop every stored credential for this server (used by the logout path). */
  async clear(): Promise<void> {
    this.#state = { version: 1, issuers: {} }
    await this.#flush()
  }

  /** Whether a token set exists, without loading the token values. */
  async hasTokens(): Promise<boolean> {
    return (await this.tokens()) !== undefined
  }
}
