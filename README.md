# Social Cinema

A mobile-first social cinema prototype: create a private watch room, choose a legally usable Blender test film, invite friends, and settle in around a landscape-first player. The current build is **Phase 1 UI only**. Room data, participants, chat, and media are mocked locally; it is not a multiplayer service yet.

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL in a browser. Use Create a cinema to configure a room, create an invite, and enter the player. Join a cinema accepts a six-character room code and opens a pre-join preview. `/cinema/AB7K92` also opens the prototype with that code prefilled (Vite's SPA fallback serves the app).

The public preview deploys from `main` using GitHub Pages. Once Pages is enabled and the Actions workflow completes, share `https://tenzinkalden8.github.io/WatchWith/`. Invite links append `?room=AB7K92` and open the join-code screen.

## Current architecture

- `src/App.jsx` contains the prototype views and lightweight local UI state; `src/providers/videoProviders.js` supplies the provider-neutral sample catalog.
- `src/App.css` contains the responsive, portrait-to-landscape layouts and cinema player styling.
- Test movie entries use a provider-neutral content shape (`id`, `title`, `provider`, `src`, `art`). A small provider registry names the MVP adapter. The video files are public Blender Foundation sample videos served by Google's public sample bucket; their availability depends on that third party.
- The player loads the video directly in each browser. No movie video is relayed through an application server.
- Camera tiles, room members, playback authority, reactions and chat are visual simulations. No camera/microphone devices or WebRTC connection are opened in this phase.

## Phase roadmap

1. **UI prototype (current):** login/home, create/join/pre-join, cinema, mock participants, controls, chat/reactions/settings.
2. **Auth and rooms:** add an authentication adapter and persistent room membership/presence with backend-enforced capacity and permissions.
3. **Real-time media:** use a WebRTC SFU for audio/video and signaling; release tracks and subscriptions on leave.
4. **Synchronized playback:** store an authoritative playback clock, broadcast play/pause/seek, and correct drift gradually.
5. **Social controls:** persistent chat/reactions, host/moderator roles, participant management and host transfer.
6. **Polish:** reconnection, accessibility, real adaptive quality, device QA and performance work.
7. **Authorized providers:** integrate only documented, officially permitted playback SDKs/APIs through provider adapters.

## Provider boundary

Keep the room/player UI dependent on normalized content metadata and a playback adapter (`initialize`, `getState`, `play`, `pause`, `seek`, `dispose`). The test adapter can be replaced or extended by an authorized provider implementation. Commercial OTT services are not accessed by this prototype; no DRM bypass, scraping, extraction, or redistribution is implemented.

## Configuration and testing

There are no application secrets or backend environment variables in Phase 1. The existing Vite scripts are `npm run dev`, `npm run build`, `npm run lint`, and `npm run preview`. A real authentication, database and SFU configuration will be documented here and in `ARCHITECTURE.md` when those phases are implemented.

## Known limitations

- Room creation, room codes and invitation sharing are client-only demonstrations. The join form does not look up or validate a server room.
- Camera and microphone toggles change UI state only; the preview is illustrative rather than a live camera.
- Playback is local to one browser, has no shared authoritative state, and may require network access to Google's sample bucket.
- Google Fonts are fetched externally; system fonts are used if unavailable.
