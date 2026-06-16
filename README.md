# YouTube Play Fix

A small Chrome extension (Manifest V3) that does two things:

1. **Refreshes the YouTube page once when a video starts playing** — resolves playback glitches that sometimes occur on the first load of a video.
2. **Fully blocks YouTube Shorts** — hides every Shorts shelf, sidebar link, thumbnail, and tab, and redirects any `/shorts/<id>` URL to the normal `/watch?v=<id>` player.

## How it works

### Play fix

A content script runs on `youtube.com` and listens for the `play` event on the page's video element. When a video starts:

1. It reads the current video ID from the URL (`?v=...`).
2. If that video hasn't already been refreshed this tab session, it sets a flag in `sessionStorage` and reloads the page.
3. After the reload the video autoplays again, but the flag is now set — so it **does not refresh again**, avoiding an infinite reload loop.

Each distinct video triggers exactly one refresh per tab session.

### Shorts blocking

- `styles.css` is injected at `document_start` and hides all Shorts UI (shelves, sidebar entries, thumbnails, the Shorts tab/chip) before the page renders, so there's no flash.
- `content.js` redirects `/shorts/<id>` URLs to `/watch?v=<id>` (both on first load and on YouTube's in-page navigations) and removes any Shorts shelves that slip through, keeping the layout gap-free.

## Installation (load unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this project folder.
5. Open a YouTube video — the page will refresh once when the video starts.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `content.js` | Detects playback (refresh) and redirects/removes Shorts |
| `styles.css` | Hides all Shorts UI elements |
| `icons/` | Toolbar / store icons |

## Notes

- Works on `www.youtube.com` and `m.youtube.com`.
- To temporarily disable, toggle the extension off in `chrome://extensions`.
- The refresh flags are cleared when the tab/browser session ends.
