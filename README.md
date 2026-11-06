# ♞ IronForge Chess

A rugged, free chess site that runs entirely on **GitHub Pages**. There's no server to pay for.

- **Bot Arena**: 8 opponents, from *Pawnstorm Pete* (~500) up to full-strength Stockfish.
- **Analysis board**: Stockfish 10, Ironclad (built-in) and Ironclad Lite engines; up to 3 engine lines, eval bar, best-move arrows, FEN/PGN import & export.
- **Game review**: accuracy for both players, move labels (Brilliant / Best / Excellent / Good / Book / Inaccuracy / Mistake / Blunder), the best move for each mistake, and an eval graph.
- **Online games**: open challenges in a live lobby or share a link; clocks (bullet → classical), draw offers, resign/abort, chat, spectating.
- **Accounts**: Google, GitHub, Microsoft, email/password and guest sign-in.
- **Profiles**: custom profile picture (upload or pick an emblem), frame colour, bio, win/loss stats.
- **Moderator (Dorian)**: a gold **MOD** badge everywhere the name appears, plus an **Admin panel** to lock/unlock accounts with a reason. Locked players get a lock screen and can't play.
- **Workshop**: 5 board themes, 3 piece styles (classic Cburnett pieces), sound on/off.

---

## 1. Put it on GitHub Pages (5 minutes)

1. Create a new repository on GitHub, e.g. `ironforge-chess` (Public).
2. Upload **everything in this folder** (keep the folder structure: `index.html`, `css/`, `js/`, `.nojekyll`…).
   - On the website: **Add file → Upload files**, drag the contents in, **Commit**.
   - Or with git:
     ```bash
     git init && git add . && git commit -m "IronForge Chess"
     git branch -M main
     git remote add origin https://github.com/YOURNAME/ironforge-chess.git
     git push -u origin main
     ```
3. Repo **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)** → **Save**.
4. After about a minute your site is live at `https://YOURNAME.github.io/ironforge-chess/`.

At this point the site works in **Local mode**. Bots, analysis, review, profiles and the admin panel all work, but accounts are saved only in each visitor's own browser. To get real accounts and real online games, do step 2.

> Local mode tip: the first person to claim the username **Dorian** in a browser becomes that browser's moderator. With Firebase (step 2) only *your* email can claim it.

## 2. Turn on real accounts and online play (free Firebase)

1. Go to <https://console.firebase.google.com> → **Add project** (Google Analytics is optional).
2. **Project overview → `</>` (Web)** → register an app → copy the `firebaseConfig` object.
3. Paste it into **`js/config.js`**:
   ```js
   firebase: {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   },
   ```
   (These keys are meant to be public. Security comes from the rules in step 6.)
4. **Build → Authentication → Get started → Sign-in method** and enable:
   - **Google**: one click.
   - **Email/Password**: one click.
   - **Anonymous**: needed for "Play as Guest".
   - **GitHub**: create an OAuth app at GitHub → Settings → Developer settings → OAuth Apps. Paste the callback URL Firebase shows you, then copy the Client ID/Secret back into Firebase.
   - **Microsoft**: register an app in the Azure portal (App registrations) with Firebase's redirect URL, then paste the App ID/secret into Firebase.
5. **Authentication → Settings → Authorized domains → Add domain:** `YOURNAME.github.io`
6. **Build → Firestore Database → Create database** (production mode, any region). Open the **Rules** tab, paste the contents of **`firestore.rules`**, and change `OWNER_EMAIL_HERE` to the email you will sign in with (for example your Gmail). Then click **Publish**.
7. Commit and push `js/config.js`. Wait a minute for Pages to update.
8. Open your site, sign in (Google is easiest) with **that email**, and claim the username **Dorian**. You'll land in the **Moderator Control Room**, and the MOD badge appears next to your name.

The rules make sure that:
- usernames are unique, and only your verified email can claim `Dorian`;
- nobody can edit their own `locked` field;
- only Dorian can lock or unlock accounts (and can't lock himself);
- locked accounts can't create, join or play games.

## 3. Engines

| Engine | Where it runs | Notes |
|---|---|---|
| **Stockfish 10** | In the visitor's browser (≈1 MB download from cdnjs, once) | Strongest. Used for the top bots, analysis and reviews. |
| **Ironclad** | In the visitor's browser (`js/engine-worker.js`) | IronForge's own alpha-beta engine. Works offline. If Stockfish can't load, the site switches to Ironclad automatically. |
| **Ironclad Lite** | Same, with a shallow search | Instant hints on slow phones. |

## Files

```
index.html            app shell
css/style.css         the rugged theme
js/config.js          ← your Firebase config + admin username
js/chess.js           full chess rules (castling, en passant, promotion, repetition…)
js/engine-worker.js   Ironclad engine
js/engines.js         engine manager (Stockfish + Ironclad) and bot list
js/board.js           board UI (drag/click, arrows, promotion, sounds)
js/pieces.js          Cburnett piece set (embedded SVG)
js/backend.js         accounts, moderation, online games (Firebase or local)
js/app.js             router, header, login, profiles, settings, admin panel
js/play.js            bot games
js/analysis.js        analysis board
js/review.js          game review
js/online.js          lobby and live games
firestore.rules       Firestore security rules (paste into Firebase)
```

## Known limits

- **Moves aren't checked on a server.** GitHub Pages can't run server code, so the browser checks every move. Someone determined could cheat using browser dev tools. Firebase Cloud Functions could fix that, but they require a paid plan.
- **Clocks run in the browser.** Timeouts are detected by the players' own browsers.
- **Opening a file directly doesn't work.** Opening `index.html` by double-clicking it blocks the engine worker. Use GitHub Pages, or run a local server: `python3 -m http.server`, then open <http://localhost:8000>.

## Credits & licences

- Pieces: Cburnett chess set (Wikimedia Commons), CC BY-SA 3.0 / GPL / BSD.
- Stockfish 10 (stockfish.js by nmrugg / lichess), GPLv3, loaded from cdnjs.
- Fonts: Black Ops One, Oswald, Roboto Condensed, JetBrains Mono (Google Fonts).
