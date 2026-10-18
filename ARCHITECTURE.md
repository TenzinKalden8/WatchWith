# Social Cinema architecture

## Implemented: UI, authentication, and rooms

```mermaid
flowchart LR
  U[Browser: React / Vite]
  A[Firebase Authentication]
  F[Cloud Firestore]
  R[Firestore security rules]
  P[Video provider adapter]
  V[Public test video source]
  U -->|email and password| A
  U -->|room transactions, listeners, presence heartbeat| F
  F --> R
  U --> P
  P -->|direct playback| V
```

Firebase Auth identifies a user. The browser uses Firestore transactions for room creation and membership changes; rules validate every write, including host identity, participant ownership, participant counts, room capacity, and host transfer. A six-character room code is an unlisted invite capability. A signed-in user with the code can read the room preview, but only a room member can list participants or read member documents. Room listings are disabled.

Presence is a Firestore `online` flag refreshed every 25 seconds while the player is open. A page-hide signal attempts to mark the user offline. Browsers cannot guarantee this cleanup on a crash or network loss, so true disconnect presence and stale-member cleanup remain future work. Camera and microphone are live through browser WebRTC. Playback state, room chat, reactions, and moderator roles are shared through Firestore.

Configuration is provided by the four `VITE_FIREBASE_*` variables. Firebase web configuration is visible to clients by design; Firestore security rules are the access boundary. No admin SDK or service account key is placed in the browser. Use a dedicated Firebase project for this app.

## Rule-validated room transaction flows

### Create

```mermaid
sequenceDiagram
  participant Client
  participant Firestore
  participant Rules
  Client->>Firestore: Transaction: create room + host participant
  Firestore->>Rules: Check owner, schema, test content, initial count, host record
  Rules-->>Firestore: Allow only as one valid atomic write
  Firestore-->>Client: Return room code
```

### Join / leave

```mermaid
sequenceDiagram
  participant Client
  participant Firestore
  participant Rules
  Client->>Firestore: Read room using invite code
  Firestore-->>Client: Private room preview
  Client->>Firestore: Transaction: add own participant + increment count
  Firestore->>Rules: Check active, capacity, participant UID, count delta
  Rules-->>Firestore: Allow / deny atomically
  Firestore-->>Client: Updated room and participant snapshots
```

On host leave, one Firestore transaction promotes the earliest joined remaining participant, removes the old host membership, and decrements the count. If no one remains, it closes the room. The Firestore emulator rule tests cover these changes.

## Implemented: real-time media

```mermaid
flowchart LR
  A[Client A: camera + mic] <-->|Direct WebRTC audio/video| B[Client B: camera + mic]
  A -->|offer, answer, ICE candidates| F[Firestore signaling + rules]
  B -->|offer, answer, ICE candidates| F
  A -->|participant state + presence| F
  B -->|participant state + presence| F
  A -->|shared state + playback commands| F
  B -->|shared state + playback commands| F
  A -->|authorized video| P[Video provider]
  B -->|authorized video| P
```

The browser requests local tracks after the user opens the pre-join screen. Each pair of room participants establishes one direct peer connection. Lexically sorted Firebase UIDs select one offerer to prevent duplicate negotiations. Firestore stores only signaling messages; camera and microphone tracks are not sent through Firestore or an application server. Leaving closes peer connections and stops local tracks.

This mesh uses Google's public STUN endpoint and has no TURN relay. Direct connection can fail behind restrictive NATs or firewalls, and upload/device load grows with each participant. Use a credentialed TURN service or managed SFU before relying on larger or production rooms. The movie itself remains between each device and its authorized provider; it is never relayed through our servers.

## Implemented: synchronized playback

The room document stores `playback: { state, position, updatedAt, controllerId }`. A play, pause, or seek writes the playback state and a server timestamp. Firestore rules allow only room members with the configured host/moderator/everyone role to change it; clients cannot grant themselves control. Other clients estimate the current position from `updatedAt` and compare it every two seconds while playing. Drift below 100 ms is ignored, drift from 100–500 ms is corrected with a small playback-rate adjustment, and drift above 500 ms is corrected with a seek. The source video is still loaded independently by every participant.

```mermaid
sequenceDiagram
  participant H as Host browser
  participant F as Firestore room state
  participant G as Guest browser
  H->>F: Write play/pause/seek + position + server timestamp
  F-->>G: Playback snapshot
  G->>G: Apply state and compare position every 2 seconds
  G->>G: Rate-correct small drift; seek only above 500 ms
```

The browser may block autoplay until the viewer taps the player once. The Firestore emulator tests cover host-only, moderator, and everyone playback permissions.

## Implemented: room chat, reactions, and moderators

```mermaid
flowchart LR
  A[Room member] -->|message| M[Firestore messages subcollection]
  M -->|ordered live query, latest 100| B[Other room members]
  A -->|emoji + server timestamp| P[Own participant record]
  P -->|participant snapshot| B
  H[Host] -->|promote or demote role| P
  R[Firestore rules] -->|member, author, emoji, host checks| M
  R -->|own reaction or host role change| P
```

Chat messages are append-only and carry the authenticated author's UID; rules prevent impersonation, edits, and deletion. Reactions are stored as the sender's most recent emoji plus a server timestamp on their participant record, avoiding a rapidly growing reaction-event collection. Clients animate only fresh reaction timestamps. The host alone can promote or demote a viewer; moderator permissions are read from the server-side participant role when playback rules are evaluated. Audio-level speaking indicators come from WebRTC `getStats()` on inbound audio and are not stored in Firestore.

The chat listener keeps the latest 100 messages. Retention policies, moderation/reporting, and removal of participants remain future work.

## Provider boundary

The player consumes normalized metadata (`provider`, `contentId`, `title`, `thumbnail`, `duration`) and a playback adapter with initialize/state/play/pause/seek/dispose operations. `TestVideoProvider` is the first catalog. Future adapters must use officially authorized APIs or SDKs and follow the provider's rules. No unsupported OTT embedding, scraping, DRM circumvention, extraction, or redistribution belongs in this system.

## Operational notes

- Auth, room creation/joining, and participant presence require a dedicated Firebase project and the public web-app config variables.
- Deploy `firestore.rules` before allowing real users to join rooms.
- The test suite uses a demo project ID and the local Firestore emulator; it does not contact production Firebase.
- Adding server-side functions or a managed SFU may introduce billing and deployment requirements. Evaluate those separately before enabling paid services.
