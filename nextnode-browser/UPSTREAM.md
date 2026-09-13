# NextNode browser runtime

Synced from https://nextnode9124.b-cdn.net/ on 2026-09-13T05:00:13.413Z.

This is the complete Scramjet browser/proxy runtime used by NEO Browser. The embedding patch makes its asset base relative, selects the upstream WISP endpoint, applies NEO branding, loads the shared ad shield, removes the upstream popup-ad loader, and avoids reading the cross-origin parent window.

Run `node scripts/sync-nextnode-browser.cjs` to refresh the pinned files and hashes.
