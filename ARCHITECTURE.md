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

Presence is a Firestore `online` flag refreshed every 25 seconds while the player is open. A page-hide signal attempts to mark the user offline. Browsers cannot guarantee this cleanup on a crash or network loss, so true disconnect presence and stale-member cleanup remain future work. Camera and microphone are not connected in this phase. Chat, reactions, and playback events are not persisted or shared.

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

## Next: real-time media and synchronized playback

```mermaid
flowchart LR
  A[Client A] -->|Firebase Auth and room membership| F[Firestore + security rules]
  B[Client B] -->|Firebase Auth and room membership| F
  A <-->|WebRTC audio/video| S[Managed SFU]
  B <-->|WebRTC audio/video| S
  A <-->|playback, chat, reactions, presence| R[Realtime room channel]
  B <-->|playback, chat, reactions, presence| R
  A -->|authorized playback| P[Video provider]
  B -->|authorized playback| P
```

The next phase should add an SFU for participant camera and microphone tracks. Playback synchronization should keep a compact authoritative state `{state, position, updatedAt, controllerId}` and compare client positions periodically. Ignore drift below 100 ms, gradually correct moderate drift when supported, and seek only for larger drift. The movie itself remains between each device and its authorized provider; it is never relayed through our servers.

## Provider boundary

The player consumes normalized metadata (`provider`, `contentId`, `title`, `thumbnail`, `duration`) and a playback adapter with initialize/state/play/pause/seek/dispose operations. `TestVideoProvider` is the first catalog. Future adapters must use officially authorized APIs or SDKs and follow the provider's rules. No unsupported OTT embedding, scraping, DRM circumvention, extraction, or redistribution belongs in this system.

## Operational notes

- Auth, room creation/joining, and participant presence require a dedicated Firebase project and the public web-app config variables.
- Deploy `firestore.rules` before allowing real users to join rooms.
- The test suite uses a demo project ID and the local Firestore emulator; it does not contact production Firebase.
- Adding server-side functions or a managed SFU may introduce billing and deployment requirements. Evaluate those separately before enabling paid services.
