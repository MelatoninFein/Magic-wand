# Magic Wand

<img src="icons/logo.png" alt="Magic Wand logo" width="96" align="right" />

A lightweight Chrome extension (Manifest V3) adding quality-of-life features and minor fixes for YouTube and other websites. Each feature can be toggled on or off from the popup:

1. **Refresh on play** — refreshes the YouTube page once when a video starts playing, resolving playback glitches that sometimes occur on the first load of a video.
2. **Block Shorts** — hides every Shorts shelf, sidebar link, thumbnail, and tab, and redirects any `/shorts/<id>` URL to the normal `/watch?v=<id>` player.
3. **Block betting sites** — blocks gambling / betting sites (a ~253,000-domain blocklist).
4. **Better volume control** — scroll over the YouTube player to change volume, with boost above 100% for quiet videos.

## Settings

Click the Magic Wand icon in the toolbar to open the settings popup. Each feature has its own switch; changes are saved instantly (via `chrome.storage.sync`) and apply to open YouTube tabs without needing to reopen the popup.

## How it works

### Refresh on play

A content script listens for the `play` event on the page's video element. When a video starts:

1. It reads the current video ID from the URL (`?v=...`).
2. If that video hasn't already been refreshed this tab session, it sets a flag in `sessionStorage` and reloads the page.
3. After the reload the video autoplays again, but the flag is now set — so it **does not refresh again**, avoiding an infinite reload loop.

Each distinct video triggers exactly one refresh per tab session.

### Block Shorts

- `styles.css` hides all Shorts UI (shelves, sidebar entries, thumbnails, the Shorts tab/chip). Its rules are scoped under an `html.mw-block-shorts` class that the content script toggles, so the setting takes effect instantly without a reload. The script adds the class at `document_start`, so Shorts are hidden before the page renders (no flash).
- `content.js` redirects `/shorts/<id>` URLs to `/watch?v=<id>` (both on first load and on YouTube's in-page navigations) and removes any Shorts shelves that slip through, keeping the layout gap-free.

### Block betting sites

Uses Chrome's `declarativeNetRequest` to **block** gambling / betting sites at the network level (the request is cancelled, so there's no loading and no custom page to hang).

The blocklist (`rules/betting-domains.json`) bundles **~253,000 domains** merged from [HaGeZi's gambling blocklist](https://github.com/hagezi/dns-blocklists) (the most comprehensive available), [StevenBlack](https://github.com/StevenBlack/hosts), [The Block List Project](https://github.com/blocklistproject/Lists), curated mainstream/crypto/skin operators, Swedish (Spelinspektionen) operators, and prediction markets (Kalshi, Polymarket, PredictIt, etc.). Domains are matched including subdomains.

There is no keyword matching, so there are **no false positives** on legitimate sites — a site is blocked only if its domain is on the list. `block` rules need no host permissions, so the extension doesn't request access to all your data. To add more sites, append domains to `rules/betting-domains.json`; `background.js` enables/disables the ruleset based on the toggle.

### Better volume control

Scroll the mouse wheel over the YouTube player to raise/lower the volume in 5% steps, with a brief on-screen indicator. Beyond 100% the audio is amplified up to 400% using a Web Audio gain node (great for quiet videos), so you can go louder than YouTube normally allows. The chosen level is remembered across videos and sessions.

## Installation (load unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this project folder.
5. Click the Magic Wand toolbar icon to choose which features are on.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `content.js` | Applies the YouTube features (refresh, Shorts, volume) based on saved settings |
| `styles.css` | Hides Shorts UI + styles the volume indicator |
| `background.js` | Enables/disables the betting-site ruleset |
| `rules/betting-domains.json` | Betting/gambling domain blocklist (~253,000 domains) |
| `popup.html` / `popup.css` / `popup.js` | Settings popup with on/off switches |
| `icons/` | Wand logo + toolbar icons |

## Notes

- Works on `www.youtube.com` and `m.youtube.com`.
- Both features default to **on** for new installs.
- The refresh flags are cleared when the tab/browser session ends.
