## OpenDrop — Multi‑User P2P File Sharing (Project Proposal & Demo Guide)

OpenDrop is an AirDrop‑style web app that lets you send files **directly between browsers** using
WebRTC DataChannels. Files never go through the server – the Node.js backend is used only for
**signaling, room management, and QR/IP helpers** so peers can find each other and negotiate a
peer‑to‑peer connection.

This README is written for **project proposal, viva/presentation, and demo**.

---

## 1. Problem Statement & Goals

- **Problem**: Sharing files between nearby devices (laptops, phones, tablets) is still painful:
  cables, messaging apps, email, or needing the same platform (e.g. AirDrop).
- **Goal**: Build a **cross‑platform, browser‑based** file sharing system that:
  - Works on **any modern browser** (desktop & mobile).
  - Requires **no installation** and **no login**.
  - Transfers files **directly between devices** (P2P, encrypted).
  - Supports **multiple users in the same room**, all able to send and receive.
  - Is **easy to join** via **QR code** or **simple 6‑digit room code**.

**One‑line pitch**:  
> OpenDrop is a browser‑based, multi‑user AirDrop alternative that uses WebRTC to send files
> directly between devices on the same network, with QR code onboarding and no server‑side file
> storage.

---

## 2. High‑Level Architecture

OpenDrop has two main parts:

- **Frontend (`public/`)** — Pure HTML/CSS/JavaScript
  - `index.html` — UI layout:
    - Connection section (name, room create/join, status, room code, QR).
    - Connected users list.
    - File transfer panel (file picker, target peer dropdown, progress UI).
  - `style.css` — Modern, responsive UI with clear status and progress feedback.
  - `app.js` — All client‑side logic:
    - WebSocket signaling client.
    - Multi‑user room handling.
    - WebRTC peer connection & DataChannel management.
    - File transfer (chunking, progress, speed).
    - QR code generation and auto‑join via URL.

- **Backend (`server.js`)** — Node.js + Express + `ws`
  - Serves the static frontend from `public/`.
  - Hosts a **WebSocket signaling server** on `/ws`.
  - Manages **rooms** and **peers**:
    - `Map<roomCode, Map<userId, { ws, userName }>>`.
  - Provides `/api/server-address` to expose the laptop’s **LAN IP + port**  
    (so QR codes always contain the correct URL for other devices).

**Important:** The backend **never sees file bytes**. Only small JSON signaling and control
messages are exchanged (room management, SDP, ICE, file metadata).

---

## 3. Core Features

- **Multi‑user rooms**
  - Any number of users can join the same 6‑digit room code.
  - Each user is assigned a unique `userId` and a display name.
  - Everyone sees a **“Connected Users”** list with live status.

- **Multi‑device support**
  - Works across:
    - Laptops (Chrome/Firefox/Safari/Edge).
    - Phones (Android Chrome, iOS Safari).
    - Tablets and other browsers.
  - Only requirement: all devices are on the **same Wi‑Fi / LAN**.

- **P2P WebRTC file transfer**
  - Each pair of users creates a **direct WebRTC peer connection**.
  - Uses **WebRTC DataChannels** for binary file chunks.
  - Transfers are **encrypted end‑to‑end (DTLS)** by the browser.

- **QR code + IP‑aware join links**
  - When you create a room, OpenDrop:
    - Calls `/api/server-address` to learn your LAN URL  
      e.g. `http://192.168.12.39:3000`.
    - Generates a QR code for `http://<your-ip>:3000?room=XXXXXX`.
  - Friends scan the QR or tap the link and land directly on the room join page.
  - No need to manually check or type your IP address.

- **Peer‑to‑peer mesh topology**
  - For `N` users in a room, OpenDrop maintains **N‑1 WebRTC connections per user**  
    (a full mesh).
  - Any user can:
    - Select **any other peer** from a dropdown.
    - Send files to that peer while still receiving from others.

- **Robust UX**
  - Clear connection status (`Disconnected`, `Connecting…`, `Connected`).
  - Per‑transfer progress bar, percentage, and speed.
  - Modal confirmation for incoming files (**Accept / Reject**).
  - Cancel button for active transfers.
  - Detailed log area for debugging/demo (“Connected to signaling server”, etc.).

---

## 4. File & Module Overview

### Root

- **`package.json`**
  - Scripts: `"start": "node server.js"`.
  - Dependencies:
    - `express` — HTTP server and static file hosting.
    - `ws` — WebSocket server for signaling.

- **`server.js`**
  - Creates Express app and HTTP server.
  - **Static files**: `app.use(express.static(path.join(__dirname, "public")));`
  - **WebSocket signaling**:
    - `wss = new WebSocket.Server({ server, path: "/ws" })`.
  - **Room management**:
    - `rooms: Map<roomCode, Map<userId, { ws, userName }>>`.
    - `create-room` / `join-room` / `signal` / `leave-room`.
  - **Server IP helper**:
    - `GET /api/server-address` → `{ baseUrl: "http://<lan-ip>:3000", host, port }`.
  - **Health & cleanup**:
    - Ping/pong heartbeat to terminate dead WebSocket clients.
    - Cleans rooms on disconnect.

- **`README.md` (this file)** — Proposal, architecture, and demo guide.
- **`TESTING_GUIDE.md`** — Step‑by‑step multi‑device testing instructions (optional handout).

### Frontend (`public/`)

- **`index.html`**
  - Semantic layout:
    - Header with project name & subtitle.
    - **Connection** card:
      - Name input (`userNameInput`).
      - Create Room / Join Room buttons.
      - Status pill (`connectionStatus`).
      - Room code display (`roomCodeDisplay`).
      - QR block (`qrCodeContainer` + `qrCodeTarget`).
      - Connected users list.
      - Log area for status messages.
    - **File Transfer** card:
      - File input (`fileInput`).
      - Peer selector (`peerSelect`).
      - Send / Cancel buttons.
      - Progress bar & speed labels.
    - **Incoming File Modal** for accept/reject.
  - Loads:
    - `qrcode.min.js` (browser QR library).
    - `app.js` (main client logic).

- **`style.css`**
  - Dark, modern theme with glassmorphism effects.
  - Responsive layout for mobile & desktop.
  - Styles for:
    - Buttons, inputs, status pills, cards.
    - Log area, room code badge.
    - QR code container and target.
    - Progress bar and file transfer UI.
    - Modal dialog for file confirmation.

- **`app.js`**
  - **State**:
    - WebSocket (`signalingSocket`).
    - `localRoomCode`, `localUserId`, `localUserName`.
    - `peerConnections: Map<userId, { peerConnection, dataChannel, userName, isConnected }>`
    - `activeTransfers: Map<userId, { direction, fileName, size, bytes, startedAt, cancelled }>`
    - `incomingFiles: Map<userId, { name, size, chunks, receivedBytes }>`
  - **Signaling**:
    - Connects to `ws://<host>/ws`.
    - Sends `create-room`, `join-room`, `signal`, `leave-room`.
    - Handles:
      - `room-created`, `room-joined`, `room-error`.
      - `user-list`, `peer-joined`, `peer-disconnected`.
      - `signal` messages (offer/answer/ICE).
  - **WebRTC & DataChannels**:
    - Creates `RTCPeerConnection` per remote user with public STUN.
    - For initiator: creates `dataChannel = pc.createDataChannel("fileChannel")`.
    - For responder: listens to `ondatachannel`.
    - Exchanges SDP offers/answers and ICE candidates via signaling server.
  - **File transfer**:
    - Metadata exchange: `file-info`, `file-accept`, `file-reject`, `file-complete`, `file-cancel`.
    - Chunked sending using `FileReader` with 16 KB chunks.
    - Progress, percentage, and transfer speed computed from bytes/time.
    - Reassembles `ArrayBuffer` chunks into `Blob` on receiver and triggers download.
  - **QR code & auto‑join**:
    - Fetches `/api/server-address` to get `baseUrl` (LAN IP + port).
    - Generates QR via `new QRCode(qrCodeTarget, { text: baseUrl + "?room=XXXXXX" })`.
    - Parses `?room=XXXXXX` on load to:
      - Prefill room code.
      - Auto‑focus name field or auto‑join if name is set.
    - “Copy Link” button copies the same join URL to clipboard.

---

## 5. How It Works (End‑to‑End Flow)

### 5.1. Room Creation & QR Join

1. **Creator (Laptop)**
   - Opens app: `http://localhost:3000`.
   - Enters name and clicks **Create Room**.
   - Frontend:
     - Opens WebSocket → `/ws`.
     - Sends `{ type: "create-room", roomCode: "<6‑digit>" }`.
   - Backend:
     - Creates room, generates `userId`, stores `(userId → ws, userName)`.
     - Responds with:
       ```json
       {
         "type": "room-created",
         "roomCode": "565031",
         "userId": "...",
         "userName": "Mohamed",
         "userList": [ ... ]
       }
       ```
   - Frontend:
     - Displays room code.
     - Calls `/api/server-address` → `http://192.168.12.39:3000`.
     - Renders QR for `http://192.168.12.39:3000?room=565031`.

2. **Joiner (Phone)**
   - On same Wi‑Fi, scans the QR with camera.
   - Browser opens: `http://192.168.12.39:3000?room=565031`.
   - App:
     - Prefills room code from URL.
     - User types name and taps **Join Room**.
     - Sends `join-room` to server.
   - Server:
     - Adds joiner to room.
     - Sends updated `userList` to everyone.
   - Both sides now start WebRTC negotiation per peer.

### 5.2. WebRTC Negotiation (Per Pair)

For each pair (`A`, `B`) in a room:

1. Decide initiator (based on lexicographical `userId`).
2. Both create `RTCPeerConnection`.
3. Initiator:
   - Creates `RTCDataChannel("fileChannel")`.
   - Creates offer, sets local description, and sends offer via signaling.
4. Responder:
   - Receives offer, sets remote description.
   - Creates answer, sets local description, and sends answer back.
5. Both exchange ICE candidates via signaling.
6. Once ICE state is `connected`/`completed`, datachannel fires `onopen` and both can send files.

### 5.3. File Transfer (Per Peer)

1. **Sender**
   - Selects target peer from dropdown.
   - Picks a file, clicks **Send File**.
   - Sends `file-info` JSON over DataChannel:
     ```json
     { "type": "file-info", "name": "photo.jpg", "size": 5242880 }
     ```

2. **Receiver**
   - Shows modal: filename & size with **Accept / Reject**.
   - On **Accept**:
     - Sends `file-accept` over DataChannel.
     - Prepares to receive chunks into an array.

3. **Sender**
   - On `file-accept`, reads file in 16 KB slices with `FileReader`.
   - Sends each `ArrayBuffer` chunk via DataChannel.
   - Updates local progress UI (percentage + speed).
   - On completion, sends `file-complete`.

4. **Receiver**
   - For each chunk, appends to in‑memory list and updates progress UI.
   - On `file-complete`, validates bytes:
     - `Blob` → `URL.createObjectURL` → auto‑download with hidden `<a>` tag.

5. **Cancel / Errors**
   - Either side sends `file-cancel` to abort.
   - UI resets, transfer state cleared.
   - Disconnects and errors are logged in the log panel.

---

## 6. How to Run the Project (Demo Setup)

### 6.1. Prerequisites

- Node.js ≥ 18 (recommended).
- Modern browser (Chrome/Firefox/Edge/Safari).
- All devices on the **same Wi‑Fi/LAN** for multi‑device testing.

### 6.2. Install & Start

```bash
cd opendrop
npm install
npm start
```

You should see logs similar to:

```text
OpenDrop server listening on http://localhost:3000
Other devices: http://192.168.12.39:3000
```

### 6.3. Accessing the App

- On your laptop (for presenting):
  - Open: `http://localhost:3000`
- On other devices (phones, tablets, other laptops):
  - Use the **“Other devices”** URL from the server log, e.g.:
    - `http://192.168.12.39:3000`

---

## 7. Suggested Live Demo Script

1. **Intro (30–60s)**
   - Explain problem + motivation (friction of cross‑device file sharing).
2. **Architecture slide / explanation (1–2 min)**
   - One simple diagram:
     - Browser clients ↔ WebSocket signaling server ↔ WebRTC P2P mesh.
3. **Live Demo (3–5 min)**
   - On laptop:
     - Open `http://localhost:3000`.
     - Enter name & click **Create Room**.
     - Show room code + QR.
   - On phone:
     - Scan QR, join room.
   - Show both devices now list each other under **Connected Users**.
   - From laptop → send an image to phone, accept on phone.
   - From phone → send another file back to laptop.
   - Optionally add a third device to show multi‑user mesh.
4. **Security & Privacy (1 min)**
   - Emphasize:
     - Files are never uploaded to server.
     - WebRTC channels are encrypted.
5. **Future Work (30–60s)**
   - Ideas:
     - Authentication or room passwords.
     - Temporary file history.
     - TURN server for cross‑network / internet sharing.

---

## 8. Security & Privacy Considerations

- **No server‑side file storage**:
  - Backend only sees signaling messages (room codes, user IDs, WebRTC SDP/ICE, and file metadata).
- **End‑to‑end encryption**:
  - WebRTC DataChannels are encrypted (DTLS) between browsers.
- **Room access control**:
  - Room access is by **6‑digit code** + being on the same network.
  - QR code only encodes the same URL you would share manually.
- **User consent**:
  - Receiver must explicitly click **Accept** before any file bytes are sent.

---

## 9. Limitations & Future Improvements

- Requires all devices to be on the **same network** (no TURN server configured yet).
- Large files depend on network quality; no resumable transfers.
- Simple numeric room codes (no authentication).

**Possible extensions:**

- Add TURN server for NAT traversal across different networks.
- Add room passwords or user authentication.
- Support multiple concurrent files per peer with a queue.
- Add drag‑and‑drop, thumbnails, and richer transfer history UI.

---

## 10. Summary

OpenDrop demonstrates a **production‑style WebRTC application** with:

- Multi‑user, multi‑device P2P file sharing.
- Real‑time signaling over WebSockets.
- Clean separation of responsibilities:
  - Backend: lightweight signaling + room/IP helper.
  - Frontend: WebRTC, DataChannels, file transfer UX.
- Easy onboarding via **QR codes** and auto‑join links.

This makes it a strong **project proposal** and **demo** for:

- Real‑time networking.
- Browser APIs (WebRTC, WebSockets).
- Practical, user‑facing system design.
