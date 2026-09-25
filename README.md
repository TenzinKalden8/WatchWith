# Social Cinema

A mobile-first social cinema prototype: create a private watch room, choose a legally usable Blender test film, invite friends, and settle in around a landscape-first player. Authentication and rooms use Firebase; camera and microphone use browser WebRTC for small rooms. Shared chat, reactions, and synchronized playback remain later phases.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL in a browser. Use Create a cinema to configure a room, create an invite, and enter the player. Join a cinema accepts a six-character room code and opens a pre-join screen. A shared link uses `?room=AB7K92` and opens the join flow with that code prefilled.

The public preview deploys from `main` using GitHub Pages. In the repository, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. Add the four `VITE_FIREBASE_*` values for project `watchwith-social-cinema` under **Settings → Secrets and variables → Actions → Variables**. Share `https://tenzinkalden8.github.io/WatchWith/` after the deployment workflow succeeds. Invite links append `?room=AB7K92` and open the join-code screen.

## Current architecture

- `src/App.jsx` contains the prototype views and lightweight local UI state; `src/providers/videoProviders.js` supplies the provider-neutral sample catalog.
- `src/firebase/` initializes Firebase only when client config is present. `src/services/auth.js` owns email/password auth; `src/services/rooms.js` owns transactional room creation, joining, participant heartbeats, and host handoff. Firestore rules validate room capacity and membership writes.
- `src/App.css` contains the responsive, portrait-to-landscape layouts and cinema player styling.
- Test movie entries use a provider-neutral content shape (`id`, `title`, `provider`, `src`, `art`). A small provider registry names the MVP adapter. The video files are public Blender Foundation sample videos served by Google's public sample bucket; their availability depends on that third party.
- The player loads the video directly in each browser. No movie video is relayed through an application server.
- Auth accounts, room records, capacity, participant lists, online heartbeats, host handoff, and camera/microphone media are real when Firebase is configured. Chat, reactions, and synchronized playback are still local prototypes.
- Camera and microphone use browser `getUserMedia` and a small-room WebRTC peer mesh. Firestore stores only pairwise offer/answer and ICE signaling; audio/video tracks travel directly between participants. Camera permission is requested on the pre-join screen.

## Phase roadmap

1. **UI prototype:** login/home, create/join/pre-join, cinema, controls, chat/reactions/settings.
2. **Auth and rooms (implemented, requires Firebase project config):** email/password auth, persistent rooms, capacity enforcement, participant presence heartbeats, and host transfer.
3. **Real-time media (implemented):** browser camera/microphone capture, pairwise WebRTC audio/video, Firestore signaling, participant media status, and track cleanup.
4. **Synchronized playback:** store an authoritative playback clock, broadcast play/pause/seek, and correct drift gradually.
5. **Social controls:** persistent chat/reactions, host/moderator roles, participant management and host transfer.
6. **Polish:** reconnection, accessibility, real adaptive quality, device QA and performance work.
7. **Authorized providers:** integrate only documented, officially permitted playback SDKs/APIs through provider adapters.

## Provider boundary

Keep the room/player UI dependent on normalized content metadata and a playback adapter (`initialize`, `getState`, `play`, `pause`, `seek`, `dispose`). The test adapter can be replaced or extended by an authorized provider implementation. Commercial OTT services are not accessed by this prototype; no DRM bypass, scraping, extraction, or redistribution is implemented.

## Configuration and testing

The Vite scripts are `npm run dev`, `npm run build`, `npm run lint`, `npm run test:rules`, and `npm run preview`. The Firebase web configuration is public client configuration; database security comes from `firestore.rules`. Do not put service account credentials or private tokens in Vite variables.

## Known limitations

- Online status is a Firestore heartbeat; browser shutdown may leave an online flag stale until the participant updates again. Reliable disconnect presence and reconnect policy are future work.
- Media uses direct peer connections with public STUN and no TURN relay. Some NATs, firewalls, and mobile networks can block direct media; a credentialed TURN service or managed SFU is needed for more reliable connections and larger rooms.
- The mesh targets small rooms (2–6 people). Each participant sends media directly to every peer, so device and upload load grows with room size.
- Chat, reactions and playback controls are not shared between clients yet.
- Playback is local to one browser, has no shared authoritative state, and may require network access to Google's sample bucket.
- Google Fonts are fetched externally; system fonts are used if unavailable.

## Firebase setup (Phase 2 and 3)

The dedicated Firebase project is `watchwith-social-cinema` (console: https://console.firebase.google.com/project/watchwith-social-cinema). Its Web app is registered, the default Firestore database is in `asia-south1`, Firestore security rules are deployed, and Email/Password Authentication is enabled. The `localhost` and `tenzinkalden8.github.io` domains are authorized. `.firebaserc` selects this project for Firebase CLI commands.

For local development, `.env.local` is already configured on the developer machine and is intentionally gitignored. To configure a new checkout, copy `.env.example` to `.env.local` and use Firebase Project settings → Your apps → SDK setup. For GitHub Pages, add these four public configuration values under **WatchWith → Settings → Secrets and variables → Actions → Variables** using names `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`; then rerun the Pages workflow. These are public web-app configuration values; database security comes from the rules. Never add service account keys to the browser or repository.

The Firebase CLI emulator configuration is in `firebase.json`. For local UI development, use demo values for all four required Firebase config fields and set `VITE_USE_FIREBASE_EMULATORS=true` in `.env.local`, then run `firebase emulators:start --only auth,firestore --project demo-social-cinema`. The Firestore rule suite is `npm run test:rules` and needs Java 21+ for the current Firebase emulator. It covers room creation, invite previews, membership privacy, capacity, participant presence writes, unauthorized controls, and host handoff.
