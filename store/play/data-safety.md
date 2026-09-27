# Google Play App content answers: Backgammon (com.skeptrune.backgammon)

Everything below comes from the code in this repo (backgammon-mobile) and the backend repo (skeptrunedev/backgammon). File paths are cited so each answer can be checked.

## What the Android app actually does with data

- No sign-in and no account. App.tsx only renders the board and game controls. There is no auth code in this repo.
- One kind of network request: the hidden engine WebView loads `https://bg.skeptrune.com/engine/gnubg.js` (plus `.wasm` and `.data`) over HTTPS (src/engine/engineHtml.ts, `ENGINE_ORIGIN` and `fetch('/engine/gnubg.js')`). These are static files. The request body carries no user data.
- Game moves go to the engine inside the on-device WebView, not over the network (src/engine/EngineWebView.tsx, src/engine/nativeClient.ts).
- Match records are saved only on the device with AsyncStorage (src/game/store.ts).
- The only dependencies are Expo, React Native, react-native-svg, react-native-webview and AsyncStorage (package.json). There is no analytics, crash reporting, ads or other third-party SDK.
- The backend serves `/engine/*` as static assets. The Worker only runs its own code for `/api/*` (skeptrunedev/backgammon wrangler.jsonc, `run_worker_first: ["/api/*"]`), and nothing in that repo logs requests. The host, Cloudflare, sees each request's IP address as part of serving it. That is out of the app's control and is covered in the privacy policy.

## Data safety form

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | **No** |
| Data collected | None |
| Data shared | None |
| Is all user data encrypted in transit? | Yes. The only request is HTTPS to bg.skeptrune.com. (Play does not ask this once you answer "No" above.) |
| Do you provide a way for users to request that their data be deleted? | Nothing is collected. On-device matches are removed by uninstalling the app or clearing its storage. For web accounts, users can email me@skeptrune.com (see privacy policy). |
| Privacy policy URL | https://bg.skeptrune.com/privacy |

Why "No" is correct: Play counts data as collected when it is sent off the device. The app sends no user data. The static engine download is a plain HTTPS GET with no user data in it, and no app or backend code stores anything from it.

### If the web features ever ship in the Android app

Sign-in, sync and AI all live in the backend repo only today. If they come to Android, the answers change:
- Personal info > Email address: collected for Account management and App functionality (worker/auth.ts email one-time code; `user` table in migrations/0001_better_auth.sql).
- App activity > Other user-generated content (match records, training progress): collected for App functionality (migrations/0002_matches.sql, 0005_training_state.sql).
- Device or other IDs / IP address: session rows store IP address and user agent (migrations/0001_better_auth.sql `session` table).
- Shared: game positions sent to Anthropic for AI explanations and Trends analysis, only when the user adds their own API key (worker/index.ts `/api/explain` calls `https://api.anthropic.com/v1/messages`).
- Account deletion: Play would then require an in-app and web way to request account deletion. The backend has no delete-account endpoint today (worker/index.ts only deletes single matches), so one would need to be built.

## Ads

**No, the app does not contain ads.** There is no ad SDK in package.json and no ad code in the source.

## App access

**All functionality is available without special access.** There is no login. A reviewer opens the app, waits for "Loading engine…" to finish (it needs an internet connection), and a 7-point match starts automatically (App.tsx `newMatch(..., 7, 2)` once the engine is ready).

## Target audience and content

- Suggested target age groups: **13-15, 16-17, 18 and over (13+)**.
- Reasoning: there is nothing age-sensitive in the app, so 18+ would needlessly shrink the audience. Including under-13 groups would put the app under the Families policy (Designed for Families requirements, stricter review of the remote code the WebView loads) for no gain. The privacy policy already says the app is not directed at children under 13.
- "Could your store listing unintentionally appeal to children?" **No.** It is a traditional board game with plain adult-oriented copy and no cartoon characters.

## Content rating questionnaire (IARC)

Category: **Game** (Board).

| Topic | Answer |
| --- | --- |
| Violence | No |
| Fear / horror | No |
| Sexuality / nudity | No |
| Language (profanity, crude humor) | No |
| Controlled substances (drugs, alcohol, tobacco) | No |
| Gambling | Backgammon involves dice but no real money. No real-money gambling and no simulated gambling: no betting, no currency, no casino content. The doubling cube only changes the points at stake in the match score. |
| Real-money gambling / rewards | No |
| Users can interact or exchange content | No (no chat, no multiplayer, single player vs the engine) |
| Shares user location | No |
| Allows digital purchases | No (no in-app purchases in package.json or source) |
| Unrestricted internet access (web browser) | No. The WebView is hidden and only loads the engine from bg.skeptrune.com (src/engine/EngineWebView.tsx). |

Expected result: the lowest rating in every region (for example, ESRB Everyone, PEGI 3).

## Other declarations

- News app: No.
- COVID-19 contact tracing: No.
- Government app: No.
- Financial features: None.
- Health: No.
