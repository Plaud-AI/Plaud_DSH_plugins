import { spawn } from 'node:child_process';
/**
 * Hand a URL to the user's default browser without blocking the host process.
 *
 * Never throws: an environment with no desktop session simply gets the URL
 * logged by the caller, and the authorization flow can still be completed by
 * pasting it elsewhere.
 */
export function openBrowser(url) {
    const [command, args] = process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]];
    try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => { });
        child.unref();
    }
    catch {
        // The caller logs the URL; a missing browser is not a fatal condition.
    }
}
