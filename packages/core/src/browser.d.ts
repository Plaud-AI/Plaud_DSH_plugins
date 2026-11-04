/**
 * Hand a URL to the user's default browser without blocking the host process.
 *
 * Never throws: an environment with no desktop session simply gets the URL
 * logged by the caller, and the authorization flow can still be completed by
 * pasting it elsewhere.
 */
export declare function openBrowser(url: string): void;
