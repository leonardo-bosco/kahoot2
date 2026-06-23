# Kahoot Vault 🎮

A live, multiplayer quiz game in the style of Kahoot — built with **vanilla
JavaScript**, **WebRTC (PeerJS)** and the **Web Audio API**. No frameworks, no
build step.

- 🌐 **No backend, no build step.** The host's browser *is* the server; players
  connect peer-to-peer with a 6-digit PIN (or by scanning the lobby QR code).
- 🎵 **Procedural music & sound effects** synthesized at runtime — no audio files.
- ✨ **Animations** for question reveals, answer tiles and an animated countdown
  ring that turns red and pulses in the final seconds.
- 📱 Works on phones and desktops; deploys to GitHub Pages as static files.

## How to play

1. One person clicks **Host a new game**, builds a quiz (or loads the sample),
   and clicks **Create game** to get a PIN.
2. Everyone else opens the same site, enters the **PIN** and a nickname, and
   taps **Join game** (or scans the QR shown in the host lobby).
3. The host clicks **Start game**. Answer fast — quicker correct answers score
   more points. A scoreboard shows after each question and a podium at the end.

## Running locally

There is **no build step and nothing to install** — the scripts load as plain
`<script>` tags (PeerJS and the QR library come from a CDN, so you need an
internet connection).

**Recommended — VS Code "Live Server":** right-click `index.html` →
**"Open with Live Server"**. This serves the game over `http://localhost:…`,
which is what you want: the lobby QR code encodes the page URL, so it only works
for phones when the page is served over HTTP (not opened as a `file://` path).

Any other static server works too, e.g.:

```bash
# Python (if installed)
python -m http.server 8000

# Node (if installed)
npx serve .
```

Then open the printed `http://localhost:…` URL.

> **Just want to preview the UI on one machine?** You can open `index.html`
> directly in a browser (`file://`) — the screens and styling render fine. Only
> the cross-device join (QR / phones) needs an HTTP server.

## Deploying to GitHub Pages

This is a static site, so deployment is just pushing and enabling Pages:

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source: Deploy from a branch**,
   **Branch: `main` / root**, and save.
4. After a minute your game is live at
   `https://<your-username>.github.io/<repo-name>/`. Share that link — anyone
   can host or join.

> WebRTC needs HTTPS to connect across different networks. GitHub Pages serves
> over HTTPS, so this works out of the box.

## Project structure

```
.
├── index.html      # All the screens (markup) + script/style includes
├── css/
│   └── style.css   # All styling: layout, game components, editor, animations
├── js/
│   └── game.js     # All game logic: quiz editor, host/player networking,
│                   #   scoring, audio engine and DOM rendering
├── README.md
└── LICENSE
```

## Tech stack

| Concern        | Choice                                   |
| -------------- | ---------------------------------------- |
| Language       | Vanilla JavaScript (no build step)       |
| Networking     | [PeerJS](https://peerjs.com/) (WebRTC)   |
| QR code        | qrcodejs (CDN)                           |
| Audio          | Web Audio API (procedural synthesis)     |
| Styling        | Plain CSS                                |
| Hosting        | Static (GitHub Pages compatible)         |

## License

[MIT](LICENSE)
