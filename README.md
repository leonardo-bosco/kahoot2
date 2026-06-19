# Kahoot 2 🎮

A live, multiplayer quiz game in the style of Kahoot — built with **vanilla
JavaScript (ES Modules)**, **WebRTC (PeerJS)** and the **Web Audio API**.

- 🌐 **No backend, no build step.** The host's browser *is* the server; players
  connect peer-to-peer with a 6-digit PIN.
- 🎵 **Procedural music & sound effects** synthesized at runtime — no audio files.
- ✨ **Animations** for question reveals, answer tiles and an animated countdown
  ring that turns red and pulses in the final seconds.
- 📱 Works on phones and desktops; deploys to GitHub Pages as static files.

## How to play

1. One person clicks **Host a new game**, builds a quiz (or loads the sample),
   and clicks **Create game** to get a PIN.
2. Everyone else opens the same site, enters the **PIN** and a nickname, and
   taps **Join game**.
3. The host clicks **Start game**. Answer fast — quicker correct answers score
   more points. A scoreboard shows after each question and a podium at the end.

## Running locally

ES Modules don't load from `file://`, so serve the folder over HTTP. Any static
server works:

```bash
# Option A — npm (uses npx, nothing to install globally)
npm run dev

# Option B — Python
python -m http.server 8000

# Option C — VS Code "Live Server" extension: right-click index.html → "Open with Live Server"
```

Then open the printed `http://localhost:…` URL.

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
├── index.html              # Markup only: screens + script/style includes
├── package.json            # Metadata + a "dev" server script
├── README.md
├── LICENSE
└── src/
    ├── main.js             # Entry point: wires modules and navigation
    ├── core/
    │   ├── config.js       # Constants & tunables (timing, scoring, colors)
    │   ├── utils.js        # DOM/string helpers
    │   └── sampleQuiz.js   # Built-in sample quiz
    ├── audio/
    │   └── soundEngine.js  # Web Audio synthesizer (music + SFX)
    ├── net/
    │   ├── protocol.js     # Message types shared by host & player
    │   ├── hostGame.js     # Host controller (PeerJS server side)
    │   └── playerGame.js   # Player controller (PeerJS client side)
    └── ui/
        ├── screens.js      # Screen router (show/hide)
        ├── quizEditor.js   # Quiz model + editor form
        ├── hostView.js     # Host DOM rendering
        └── playerView.js   # Player DOM rendering
    └── styles/
        ├── base.css        # Tokens, reset, layout, buttons, forms
        ├── components.css  # Game components (timer, answers, podium…)
        ├── editor.css      # Quiz editor form
        └── animations.css  # Keyframes + animation classes
```

### Architecture notes

- **Separation of concerns.** Networking (`net/`) never touches the DOM
  directly — it calls into `ui/` render functions. Rendering modules never
  contain game logic. This keeps the game loop readable and the visuals easy
  to restyle.
- **Single source of truth for the protocol.** Both sides import message names
  from `net/protocol.js`, so the host and player can't drift out of sync.
- **No magic numbers.** Timing, scoring and layout constants live in
  `core/config.js`.

## Tech stack

| Concern        | Choice                                  |
| -------------- | --------------------------------------- |
| Language       | Vanilla JavaScript (ES Modules)         |
| Networking     | [PeerJS](https://peerjs.com/) (WebRTC)  |
| Audio          | Web Audio API (procedural synthesis)    |
| Styling        | Plain CSS, split by responsibility      |
| Hosting        | Static (GitHub Pages compatible)        |

## License

[MIT](LICENSE)
