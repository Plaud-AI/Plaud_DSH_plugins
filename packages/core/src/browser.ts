import { spawn } from 'node:child_process'

/**
 * Hand a URL to the user's default browser without blocking the host process.
 *
 * Never throws: an environment with no desktop session simply gets the URL
 * logged by the caller, and the authorization flow can still be completed by
 * pasting it elsewhere.
 */
export function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      // Node only quotes an argv element when it contains whitespace or a
      // quote, so a bare authorization URL reaches cmd.exe with its `&`
      // separators live and the browser gets everything up to the first query
      // parameter — for Notion that is exactly `?response_type=code`, and the
      // server answers `client_id is required`. Build the command line here and
      // pass it verbatim so the URL keeps its quotes.
      const command = `start "" "${url.replace(/"/g, '')}"`
      const child = spawn(process.env.comspec ?? 'cmd.exe', ['/d', '/s', '/c', command], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true,
      })
      child.on('error', () => {})
      child.unref()
      return
    }

    const [command, args] =
      process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // The caller logs the URL; a missing browser is not a fatal condition.
  }
}
