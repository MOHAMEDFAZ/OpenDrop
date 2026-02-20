(() => {
  const CHUNK_SIZE = 16 * 1024; // 16 KB

  const createRoomBtn = document.getElementById("createRoomBtn");
  const joinRoomBtn = document.getElementById("joinRoomBtn");
  const roomCodeInput = document.getElementById("roomCodeInput");
  const userNameInput = document.getElementById("userNameInput");
  const connectionStatusEl = document.getElementById("connectionStatus");
  const roomInfoEl = document.getElementById("roomInfo");
  const roomCodeDisplayEl = document.getElementById("roomCodeDisplay");
  const qrCodeContainer = document.getElementById("qrCodeContainer");
  const qrCodeTarget = document.getElementById("qrCodeTarget");
  const copyLinkBtn = document.getElementById("copyLinkBtn");

  let serverBaseUrl = null; // Fetched from /api/server-address so QR uses device IP:port
  const logArea = document.getElementById("logArea");
  const usersList = document.getElementById("usersList");
  const usersListItems = document.getElementById("usersListItems");

  const transferPanel = document.getElementById("transferPanel");
  const fileInput = document.getElementById("fileInput");
  const peerSelect = document.getElementById("peerSelect");
  const sendFileBtn = document.getElementById("sendFileBtn");
  const cancelTransferBtn = document.getElementById("cancelTransferBtn");
  const progressLabel = document.getElementById("progressLabel");
  const progressBar = document.getElementById("progressBar");
  const progressPercent = document.getElementById("progressPercent");
  const transferSpeed = document.getElementById("transferSpeed");

  const modalBackdrop = document.getElementById("modalBackdrop");
  const incomingFileNameEl = document.getElementById("incomingFileName");
  const incomingFileSizeEl = document.getElementById("incomingFileSize");
  const acceptFileBtn = document.getElementById("acceptFileBtn");
  const rejectFileBtn = document.getElementById("rejectFileBtn");

  let signalingSocket = null;
  let localRoomCode = null;
  let localUserId = null;
  let localUserName = null;
  let isRoomCreator = false;

  // Multiple peer connections: Map<userId, { peerConnection, dataChannel, userName, isConnected }>
  const peerConnections = new Map();

  // Active transfers: Map<userId, { direction, file, size, bytes, startedAt, cancelled }>
  const activeTransfers = new Map();

  // Incoming file info: Map<userId, { name, size, chunks, receivedBytes }>
  const incomingFiles = new Map();

  const log = (message, options = {}) => {
    const line = document.createElement("div");
    line.className = "log-line";
    if (options.muted) {
      line.classList.add("log-line-muted");
    }
    line.textContent = message;
    logArea.appendChild(line);
    logArea.scrollTop = logArea.scrollHeight;
  };

  const setStatus = (label, state) => {
    connectionStatusEl.textContent = label;
    connectionStatusEl.classList.remove("disconnected", "connecting", "connected");
    connectionStatusEl.classList.add(state);
  };

  const fetchServerBaseUrl = async () => {
    if (serverBaseUrl) return serverBaseUrl;
    try {
      const res = await fetch("/api/server-address");
      const data = await res.json();
      if (data.baseUrl) {
        serverBaseUrl = data.baseUrl;
        return serverBaseUrl;
      }
    } catch (e) {
      console.warn("Could not fetch server address:", e);
    }
    serverBaseUrl = window.location.origin;
    return serverBaseUrl;
  };

  const generateJoinUrl = (code) => {
    const base = serverBaseUrl || window.location.origin;
    return `${base}?room=${code}`;
  };

  const generateQRCode = async (code) => {
    try {
      await fetchServerBaseUrl();
      const joinUrl = generateJoinUrl(code);

      if (typeof QRCode === "undefined") {
        log("QR code library not loaded. Refresh the page and try again.", { muted: false });
        return;
      }

      qrCodeTarget.innerHTML = "";
      new QRCode(qrCodeTarget, {
        text: joinUrl,
        width: 200,
        height: 200,
      });
      qrCodeContainer.classList.remove("hidden");
      log("QR code generated. Scan to join.", { muted: true });
    } catch (err) {
      console.error("Error generating QR code:", err);
      log("Failed to generate QR code. You can still share the room code.", { muted: false });
    }
  };

  const showRoomInfo = (code) => {
    localRoomCode = code;
    roomCodeDisplayEl.textContent = code;
    roomInfoEl.classList.remove("hidden");
    // Generate QR code after a short delay to ensure library is loaded
    setTimeout(() => generateQRCode(code), 200);
  };

  const hideRoomInfo = () => {
    localRoomCode = null;
    roomInfoEl.classList.add("hidden");
    roomCodeDisplayEl.textContent = "";
    qrCodeContainer.classList.add("hidden");
    qrCodeTarget.innerHTML = "";
  };

  const updateUsersList = (userList) => {
    usersListItems.innerHTML = "";
    const otherUsers = userList.filter((user) => user.userId !== localUserId);
    
    if (otherUsers.length === 0) {
      usersList.classList.add("hidden");
      return;
    }
    usersList.classList.remove("hidden");

    otherUsers.forEach((user) => {
      const li = document.createElement("li");
      li.className = "user-item";
      const peer = peerConnections.get(user.userId);
      const status = peer && peer.isConnected ? "connected" : "connecting";

      li.innerHTML = `
        <span class="user-name">${escapeHtml(user.userName)}</span>
        <span class="user-status ${status}">${status === "connected" ? "Connected" : "Connecting..."}</span>
      `;
      usersListItems.appendChild(li);

      // Update peer info if exists
      if (peer) {
        peer.userName = user.userName;
      }
    });
  };

  const updatePeerSelect = () => {
    peerSelect.innerHTML = '<option value="">Select a peer...</option>';
    peerConnections.forEach((peer, userId) => {
      if (peer.isConnected && userId !== localUserId) {
        const option = document.createElement("option");
        option.value = userId;
        option.textContent = peer.userName || `User ${userId.slice(-6)}`;
        peerSelect.appendChild(option);
      }
    });
    peerSelect.disabled = peerSelect.options.length <= 1;
    sendFileBtn.disabled = !fileToSend || peerSelect.value === "" || peerSelect.disabled;
  };

  const escapeHtml = (text) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const showTransferPanel = () => {
    transferPanel.classList.remove("hidden");
    transferPanel.setAttribute("aria-hidden", "false");
  };

  const hideTransferPanel = () => {
    transferPanel.classList.add("hidden");
    transferPanel.setAttribute("aria-hidden", "true");
  };

  const resetProgress = (userId = null) => {
    if (userId) {
      activeTransfers.delete(userId);
      incomingFiles.delete(userId);
    } else {
      activeTransfers.clear();
      incomingFiles.clear();
    }
    updateProgressUI();
  };

  const updateProgressUI = () => {
    // Show the most recent active transfer
    const transfers = Array.from(activeTransfers.entries());
    if (transfers.length === 0) {
    progressBar.style.width = "0%";
    progressPercent.textContent = "0%";
    transferSpeed.textContent = "0 KB/s";
    progressLabel.textContent = "No active transfer";
    cancelTransferBtn.disabled = true;
      return;
    }

    // For now, show the first active transfer
    const [userId, transfer] = transfers[0];
    const peer = peerConnections.get(userId);
    const userName = peer ? peer.userName : `User ${userId.slice(-6)}`;

    const pct = Math.min(100, (transfer.bytes / Math.max(1, transfer.size)) * 100);
    progressBar.style.width = `${pct.toFixed(2)}%`;
    progressPercent.textContent = `${pct.toFixed(1)}%`;
    transferSpeed.textContent = computeSpeed(transfer.bytes, transfer.startedAt);
    progressLabel.textContent = `${transfer.direction === "send" ? "Sending" : "Receiving"} ${transfer.fileName || "file"} ${transfer.direction === "send" ? "to" : "from"} ${userName}`;
    cancelTransferBtn.disabled = false;
  };

  const bytesToSize = (bytes) => {
    if (!Number.isFinite(bytes)) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value.toFixed(1)} ${units[i]}`;
  };

  const computeSpeed = (bytes, startedAt) => {
    const elapsedSec = (performance.now() - startedAt) / 1000;
    if (elapsedSec <= 0) return "0 KB/s";
    const rate = bytes / elapsedSec;
    if (rate >= 1024 * 1024) {
      return `${(rate / (1024 * 1024)).toFixed(1)} MB/s`;
    }
    return `${(rate / 1024).toFixed(1)} KB/s`;
  };

  const getSignalingUrl = () => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.host}/ws`;
  };

  const ensureSignalingConnection = () =>
    new Promise((resolve, reject) => {
      if (signalingSocket && signalingSocket.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const url = getSignalingUrl();
      try {
        signalingSocket = new WebSocket(url);
      } catch (err) {
        log(`Failed to connect to signaling server: ${err.message || err}`, { muted: false });
        setStatus("Disconnected", "disconnected");
        reject(err);
        return;
      }

      setStatus("Connecting…", "connecting");
      log("Connecting to signaling server…", { muted: true });

      signalingSocket.onopen = () => {
        log("Connected to signaling server.", { muted: true });
        resolve();
      };

      signalingSocket.onerror = (ev) => {
        log("Signaling WebSocket error.", { muted: false });
        console.error("Signaling error", ev);
        setStatus("Disconnected", "disconnected");
      };

      signalingSocket.onclose = () => {
        log("Signaling connection closed.", { muted: false });
        setStatus("Disconnected", "disconnected");
      };

      signalingSocket.onmessage = (event) => {
        handleSignalingMessage(event.data);
      };
    });

  const sendSignaling = (message) => {
    if (!signalingSocket || signalingSocket.readyState !== WebSocket.OPEN) {
      log("Cannot send signaling message: socket not open.", { muted: false });
      return;
    }
    signalingSocket.send(JSON.stringify(message));
  };

  const createRandomRoomCode = () => {
    const code = Math.floor(100000 + Math.random() * 900000);
    return String(code);
  };

  const setupPeerConnection = (targetUserId, targetUserName, isInitiator) => {
    if (peerConnections.has(targetUserId)) {
      return; // Already have a connection
    }

    const configuration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const peerConnection = new RTCPeerConnection(configuration);
    let dataChannel = null;

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && localRoomCode) {
        sendSignaling({
          type: "signal",
          roomCode: localRoomCode,
          targetUserId,
          payload: { type: "ice-candidate", candidate: event.candidate },
        });
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      const peer = peerConnections.get(targetUserId);
      if (!peer) return;

      log(`ICE connection state changed to: ${state} for ${targetUserName || `User ${targetUserId.slice(-6)}`}`, { muted: true });

      if (state === "connected" || state === "completed") {
        peer.isConnected = true;
        log(`Connected to ${targetUserName || `User ${targetUserId.slice(-6)}`}.`);
        updatePeerSelect();
        updateUsersList(Array.from(peerConnections.entries()).map(([id, p]) => ({
          userId: id,
          userName: p.userName,
        })).concat([{ userId: localUserId, userName: localUserName }]));
        if (peerConnections.size > 0) {
        setStatus("Connected", "connected");
          showTransferPanel();
        }
      } else if (state === "checking") {
        log(`Connecting to ${targetUserName || `User ${targetUserId.slice(-6)}`}...`, { muted: true });
        setStatus("Connecting…", "connecting");
      } else if (state === "disconnected") {
        log(`Connection to ${targetUserName || `User ${targetUserId.slice(-6)}`} disconnected.`, { muted: false });
        peer.isConnected = false;
        updatePeerSelect();
        // Don't cleanup on disconnected, wait for failed
      } else if (state === "failed") {
        log(`Connection to ${targetUserName || `User ${targetUserId.slice(-6)}`} failed.`, { muted: false });
        peer.isConnected = false;
        updatePeerSelect();
        cleanupPeerConnection(targetUserId);
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      const state = peerConnection.connectionState;
      const peer = peerConnections.get(targetUserId);
      if (!peer) return;

      if (state === "failed" || state === "disconnected" || state === "closed") {
        log(`Peer connection to ${targetUserName || `User ${targetUserId.slice(-6)}`} ${state}.`, { muted: false });
        peer.isConnected = false;
        updatePeerSelect();
        cleanupPeerConnection(targetUserId);
      }
    };

    if (isInitiator) {
      dataChannel = peerConnection.createDataChannel("fileChannel");
      configureDataChannel(dataChannel, targetUserId, targetUserName);
    } else {
      peerConnection.ondatachannel = (event) => {
        dataChannel = event.channel;
        configureDataChannel(dataChannel, targetUserId, targetUserName);
      };
    }

    peerConnections.set(targetUserId, {
      peerConnection,
      dataChannel,
      userName: targetUserName,
      isConnected: false,
    });
  };

  const configureDataChannel = (dataChannel, targetUserId, targetUserName) => {
    if (!dataChannel) return;

    dataChannel.binaryType = "arraybuffer";

    dataChannel.onopen = () => {
      const peer = peerConnections.get(targetUserId);
      if (peer) {
        peer.dataChannel = dataChannel;
        peer.isConnected = true;
      }
      log(`Data channel open with ${targetUserName || `User ${targetUserId.slice(-6)}`}.`);
      updatePeerSelect();
      updateUsersList(Array.from(peerConnections.entries()).map(([id, p]) => ({
        userId: id,
        userName: p.userName,
      })).concat([{ userId: localUserId, userName: localUserName }]));
      
      // Check if all peers are connected
      const allConnected = Array.from(peerConnections.values()).every(p => p.isConnected);
      if (allConnected && peerConnections.size > 0) {
        setStatus("Connected", "connected");
        showTransferPanel();
      } else if (peerConnections.size > 0) {
        setStatus("Connecting…", "connecting");
        showTransferPanel();
      }
    };

    dataChannel.onclose = () => {
      log(`Data channel closed with ${targetUserName || `User ${targetUserId.slice(-6)}`}.`);
      const peer = peerConnections.get(targetUserId);
      if (peer) {
        peer.isConnected = false;
      }
      updatePeerSelect();
      resetProgress(targetUserId);
    };

    dataChannel.onerror = (event) => {
      log(`Data channel error with ${targetUserName || `User ${targetUserId.slice(-6)}`}.`, { muted: false });
      console.error("DataChannel error", event);
    };

    dataChannel.onmessage = (event) => {
      handleDataChannelMessage(event.data, targetUserId);
    };
  };

  const cleanupPeerConnection = (userId) => {
    const peer = peerConnections.get(userId);
    if (!peer) return;

    if (peer.dataChannel) {
      try {
        peer.dataChannel.close();
      } catch (e) {
        // ignore
      }
    }
    if (peer.peerConnection) {
      try {
        peer.peerConnection.close();
      } catch (e) {
        // ignore
      }
    }
    peerConnections.delete(userId);
    resetProgress(userId);
    updatePeerSelect();

    if (peerConnections.size === 0) {
      hideTransferPanel();
      setStatus("Disconnected", "disconnected");
      usersList.classList.add("hidden");
    }
  };

  const createAndSendOffer = async (targetUserId) => {
    const peer = peerConnections.get(targetUserId);
    if (!peer || !peer.peerConnection) {
      log(`Cannot create offer: peer connection not ready for ${targetUserId}.`, { muted: true });
      return;
    }
    
    // Check if connection is in a valid state
    const state = peer.peerConnection.signalingState;
    if (state !== "stable" && state !== "have-local-offer") {
      log(`Peer connection not in stable state: ${state}. Retrying...`, { muted: true });
      setTimeout(() => createAndSendOffer(targetUserId), 500);
      return;
    }

    try {
      const offer = await peer.peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await peer.peerConnection.setLocalDescription(offer);
      sendSignaling({
        type: "signal",
        roomCode: localRoomCode,
        targetUserId,
        payload: { type: "offer", sdp: offer },
      });
      log(`Sent WebRTC offer to ${peer.userName || `User ${targetUserId.slice(-6)}`}.`, { muted: true });
    } catch (err) {
      log(`Failed to create/send offer: ${err.message || err}`, { muted: false });
      // Retry once after a delay
      setTimeout(() => {
        const retryPeer = peerConnections.get(targetUserId);
        if (retryPeer && retryPeer.peerConnection) {
          createAndSendOffer(targetUserId);
        }
      }, 1000);
    }
  };

  const handleOffer = async (offer, fromUserId) => {
    let peer = peerConnections.get(fromUserId);
    if (!peer) {
      // Create connection if it doesn't exist
      setupPeerConnection(fromUserId, `User ${fromUserId.slice(-6)}`, false);
      peer = peerConnections.get(fromUserId);
      if (!peer) {
        log(`Failed to create peer connection for ${fromUserId}.`, { muted: false });
        return;
      }
    }

    // Check connection state before handling offer
    const state = peer.peerConnection.signalingState;
    if (state !== "stable" && state !== "have-remote-offer") {
      log(`Peer connection in state ${state}, waiting before handling offer...`, { muted: true });
      // Wait a bit and retry
      setTimeout(() => handleOffer(offer, fromUserId), 200);
      return;
    }

    try {
      await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.peerConnection.createAnswer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await peer.peerConnection.setLocalDescription(answer);
      sendSignaling({
        type: "signal",
        roomCode: localRoomCode,
        targetUserId: fromUserId,
        payload: { type: "answer", sdp: answer },
      });
      log(`Received offer and sent answer to ${peer.userName || `User ${fromUserId.slice(-6)}`}.`, { muted: true });
    } catch (err) {
      log(`Error handling offer: ${err.message || err}`, { muted: false });
      // Retry once
      setTimeout(() => {
        const retryPeer = peerConnections.get(fromUserId);
        if (retryPeer && retryPeer.peerConnection) {
          handleOffer(offer, fromUserId);
        }
      }, 500);
    }
  };

  const handleAnswer = async (answer, fromUserId) => {
    const peer = peerConnections.get(fromUserId);
    if (!peer || !peer.peerConnection) return;
    try {
      await peer.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      log(`Received answer from ${peer.userName || `User ${fromUserId.slice(-6)}`}.`, { muted: true });
    } catch (err) {
      log(`Error applying answer: ${err.message || err}`, { muted: false });
    }
  };

  const handleIceCandidate = async (candidate, fromUserId) => {
    const peer = peerConnections.get(fromUserId);
    if (!peer || !peer.peerConnection) return;
    try {
      await peer.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      log(`Error adding ICE candidate: ${err.message || err}`, { muted: false });
    }
  };

  const handleSignalingMessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      log("Received malformed signaling message.", { muted: false });
      return;
    }

    switch (msg.type) {
      case "room-created":
        localUserId = msg.userId;
        localUserName = msg.userName;
        showRoomInfo(msg.roomCode);
        setStatus("Waiting for peers…", "connecting");
        log(`Room created. Share this code: ${msg.roomCode}`);
        // Update user list if provided
        if (msg.userList) {
          updateUsersList(msg.userList);
        }
        break;

      case "room-joined":
        localUserId = msg.userId;
        localUserName = msg.userName;
        showRoomInfo(msg.roomCode);
        setStatus("Connecting to peers…", "connecting");
        log(`Joined room ${msg.roomCode}.`);
        // Establish connections with all existing peers
        if (msg.userList) {
          updateUsersList(msg.userList);
          // Wait a bit for WebRTC to be ready, then establish connections
          setTimeout(() => {
            msg.userList.forEach((user) => {
              if (user.userId !== localUserId && !peerConnections.has(user.userId)) {
                const isInitiator = localUserId > user.userId; // Lexicographic comparison
                setupPeerConnection(user.userId, user.userName, isInitiator);
                if (isInitiator) {
                  // Give the connection a moment to set up before sending offer
                  setTimeout(() => {
                    const peer = peerConnections.get(user.userId);
                    if (peer && peer.peerConnection) {
                      createAndSendOffer(user.userId);
                    }
                  }, 300);
                }
              }
            });
          }, 100);
        }
        break;

      case "room-error":
        log(`Room error: ${msg.reason || "Unknown error"}`, { muted: false });
        setStatus("Disconnected", "disconnected");
        hideRoomInfo();
        break;

      case "user-list":
        updateUsersList(msg.userList || []);
        // Establish connections with all peers that we don't have yet
        setTimeout(() => {
          (msg.userList || []).forEach((user) => {
            if (user.userId !== localUserId && !peerConnections.has(user.userId)) {
              const isInitiator = localUserId > user.userId; // Lexicographic comparison
              setupPeerConnection(user.userId, user.userName, isInitiator);
              if (isInitiator) {
                setTimeout(() => {
                  const peer = peerConnections.get(user.userId);
                  if (peer && peer.peerConnection) {
                    createAndSendOffer(user.userId);
                  }
                }, 300);
              }
            }
          });
        }, 100);
        break;

      case "peer-joined":
        const newUser = { userId: msg.newUserId, userName: msg.newUserName };
        if (msg.userList) {
          updateUsersList(msg.userList);
        }
        if (newUser.userId !== localUserId && !peerConnections.has(newUser.userId)) {
          const isInitiator = localUserId > newUser.userId; // Lexicographic comparison
          setupPeerConnection(newUser.userId, newUser.userName, isInitiator);
          if (isInitiator) {
            setTimeout(() => {
              const peer = peerConnections.get(newUser.userId);
              if (peer && peer.peerConnection) {
                createAndSendOffer(newUser.userId);
              }
            }, 300);
          }
        }
        log(`${newUser.userName} joined the room.`);
        break;

      case "peer-disconnected":
        const disconnectedUserId = msg.disconnectedUserId;
        log(`Peer ${disconnectedUserId} disconnected.`, { muted: false });
        cleanupPeerConnection(disconnectedUserId);
        updateUsersList(msg.userList || []);
        break;

      case "signal": {
        if (!msg.payload) return;
        const fromUserId = msg.fromUserId;
        if (!fromUserId) return;

        // Ensure we have a peer connection for this user
        if (!peerConnections.has(fromUserId)) {
          // This shouldn't happen, but handle it gracefully
          log(`Received signal from unknown user ${fromUserId}.`, { muted: false });
          return;
        }

        const { type, sdp, candidate } = msg.payload;
        if (type === "offer" && sdp) {
          handleOffer(sdp, fromUserId);
        } else if (type === "answer" && sdp) {
          handleAnswer(sdp, fromUserId);
        } else if (type === "ice-candidate" && candidate) {
          handleIceCandidate(candidate, fromUserId);
        }
        break;
      }

      default:
        break;
    }
  };

  const openIncomingFileModal = (info, fromUserId) => {
    incomingFiles.set(fromUserId, {
      name: info.name,
      size: info.size,
      chunks: [],
      receivedBytes: 0,
    });

    incomingFileNameEl.textContent = info.name;
    incomingFileSizeEl.textContent = bytesToSize(info.size);
    modalBackdrop.dataset.fromUserId = fromUserId;
    modalBackdrop.classList.remove("hidden");
    modalBackdrop.setAttribute("aria-hidden", "false");
  };

  const closeIncomingFileModal = () => {
    modalBackdrop.classList.add("hidden");
    modalBackdrop.setAttribute("aria-hidden", "true");
    delete modalBackdrop.dataset.fromUserId;
  };

  const handleDataChannelMessage = (data, fromUserId) => {
    if (typeof data === "string") {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (err) {
        log("Received malformed control message on data channel.", { muted: false });
        return;
      }

      switch (msg.type) {
        case "file-info":
          if (!msg.name || typeof msg.size !== "number") {
            log("Received invalid file metadata.", { muted: false });
            return;
          }
          const peer = peerConnections.get(fromUserId);
          openIncomingFileModal(
            { name: msg.name, size: msg.size },
            fromUserId
          );
          break;

        case "file-accept":
          const sendTransfer = activeTransfers.get(fromUserId);
          if (!sendTransfer || sendTransfer.direction !== "send") {
            log("Received file-accept but no file is queued.", { muted: false });
            return;
          }
          sendTransfer.cancelled = false;
          startSendingFile(sendTransfer.file, fromUserId);
          break;

        case "file-reject":
          log("Peer rejected the file.", { muted: false });
          resetProgress(fromUserId);
          break;

        case "file-complete":
          const receiveTransfer = activeTransfers.get(fromUserId);
          if (receiveTransfer && receiveTransfer.direction === "receive") {
            finalizeReceivedFile(fromUserId);
          }
          break;

        case "file-cancel":
          log("Peer cancelled the transfer.", { muted: false });
          resetProgress(fromUserId);
          break;

        default:
          break;
      }
      return;
    }

    if (!(data instanceof ArrayBuffer)) {
      return;
    }

    const incomingFile = incomingFiles.get(fromUserId);
    if (!incomingFile) {
      log("Received data without file metadata; discarding.", { muted: false });
      return;
    }

    incomingFile.chunks.push(data);
    incomingFile.receivedBytes += data.byteLength;

    let transfer = activeTransfers.get(fromUserId);
    if (!transfer || transfer.direction !== "receive") {
      transfer = {
        direction: "receive",
        fileName: incomingFile.name,
        size: incomingFile.size,
        bytes: 0,
        startedAt: performance.now(),
        cancelled: false,
      };
      activeTransfers.set(fromUserId, transfer);
    }
    transfer.bytes = incomingFile.receivedBytes;

    updateProgressUI();
  };

  const startSendingFile = (file, targetUserId) => {
    const peer = peerConnections.get(targetUserId);
    if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== "open") {
      log("Data channel is not open; cannot send file.", { muted: false });
      return;
    }

    const transfer = {
      direction: "send",
      file,
      fileName: file.name,
      size: file.size,
      bytes: 0,
      startedAt: performance.now(),
      cancelled: false,
    };
    activeTransfers.set(targetUserId, transfer);
    updateProgressUI();
    cancelTransferBtn.disabled = false;

    const reader = new FileReader();
    let offset = 0;

    const readSlice = () => {
      const currentTransfer = activeTransfers.get(targetUserId);
      if (!currentTransfer || currentTransfer.cancelled) {
        log("Transfer cancelled locally.", { muted: false });
        resetProgress(targetUserId);
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const currentTransfer = activeTransfers.get(targetUserId);
      if (!currentTransfer || currentTransfer.cancelled) {
        resetProgress(targetUserId);
        return;
      }

      const result = e.target && e.target.result;
      if (!(result instanceof ArrayBuffer)) {
        log("Unexpected FileReader result type.", { muted: false });
        resetProgress(targetUserId);
        return;
      }

      try {
        peer.dataChannel.send(result);
      } catch (err) {
        log(`Error sending chunk: ${err.message || err}`, { muted: false });
        resetProgress(targetUserId);
        return;
      }

      offset += result.byteLength;
      currentTransfer.bytes = offset;
      updateProgressUI();

      if (offset < file.size) {
        setTimeout(readSlice, 0);
      } else {
        try {
          peer.dataChannel.send(JSON.stringify({ type: "file-complete" }));
        } catch (err) {
          log(`Error sending file-complete: ${err.message || err}`, { muted: false });
        }
        log("File transfer complete.");
        resetProgress(targetUserId);
      }
    };

    reader.onerror = () => {
      log("File reading error occurred during transfer.", { muted: false });
      resetProgress(targetUserId);
    };

    readSlice();
  };

  const finalizeReceivedFile = (fromUserId) => {
    const incomingFile = incomingFiles.get(fromUserId);
    if (!incomingFile) return;

    try {
      const blob = new Blob(incomingFile.chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = incomingFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      log("File received and download triggered.");
    } catch (err) {
      log(`Error assembling received file: ${err.message || err}`, { muted: false });
    }
    resetProgress(fromUserId);
    closeIncomingFileModal();
  };

  let fileToSend = null;

  createRoomBtn.addEventListener("click", async () => {
    try {
      await ensureSignalingConnection();
    } catch {
      return;
    }

    isRoomCreator = true;
    localUserName = userNameInput.value.trim() || `User ${Date.now().toString().slice(-6)}`;
    const code = createRandomRoomCode();
    sendSignaling({ type: "create-room", roomCode: code, userName: localUserName });
  });

  joinRoomBtn.addEventListener("click", async () => {
    const raw = roomCodeInput.value.trim();
    if (!/^\d{6}$/.test(raw)) {
      log("Please enter a valid 6-digit room code.", { muted: false });
      return;
    }

    try {
      await ensureSignalingConnection();
    } catch {
      return;
    }

    isRoomCreator = false;
    localUserName = userNameInput.value.trim() || `User ${Date.now().toString().slice(-6)}`;
    sendSignaling({ type: "join-room", roomCode: raw, userName: localUserName });
  });

  fileInput.addEventListener("change", () => {
    if (!fileInput.files || fileInput.files.length === 0) {
      fileToSend = null;
      sendFileBtn.disabled = true;
      return;
    }
    fileToSend = fileInput.files[0];
    updatePeerSelect();
  });

  peerSelect.addEventListener("change", () => {
    sendFileBtn.disabled = !fileToSend || peerSelect.value === "" || peerSelect.disabled;
  });

  sendFileBtn.addEventListener("click", () => {
    if (!fileToSend) {
      log("Select a file before sending.", { muted: false });
      return;
    }
    const targetUserId = peerSelect.value;
    if (!targetUserId) {
      log("Select a peer to send to.", { muted: false });
      return;
    }

    const peer = peerConnections.get(targetUserId);
    if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== "open") {
      log("Data channel is not ready.", { muted: false });
      return;
    }

    const metadata = {
      type: "file-info",
      name: fileToSend.name,
      size: fileToSend.size,
    };

    try {
      peer.dataChannel.send(JSON.stringify(metadata));
    } catch (err) {
      log(`Failed to send file metadata: ${err.message || err}`, { muted: false });
      return;
    }

    // Store the file for when peer accepts
    activeTransfers.set(targetUserId, {
      direction: "send",
      file: fileToSend,
      fileName: fileToSend.name,
      size: fileToSend.size,
      bytes: 0,
      startedAt: performance.now(),
      cancelled: false,
    });

    updateProgressUI();
    log(`Sent file metadata for ${fileToSend.name} (${bytesToSize(fileToSend.size)}).`);
  });

  cancelTransferBtn.addEventListener("click", () => {
    // Cancel all active transfers
    activeTransfers.forEach((transfer, userId) => {
      if (transfer.direction === "send") {
        const peer = peerConnections.get(userId);
        if (peer && peer.dataChannel && peer.dataChannel.readyState === "open") {
          try {
            peer.dataChannel.send(JSON.stringify({ type: "file-cancel" }));
      } catch (err) {
        log(`Error sending cancel message: ${err.message || err}`, { muted: false });
      }
    }
      }
      transfer.cancelled = true;
    });
    resetProgress();
  });

  acceptFileBtn.addEventListener("click", () => {
    const fromUserId = modalBackdrop.dataset.fromUserId;
    if (!fromUserId) {
      log("Cannot accept file: no sender ID.", { muted: false });
      resetProgress();
      return;
    }

    closeIncomingFileModal();
    const peer = peerConnections.get(fromUserId);
    if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== "open") {
      log("Cannot accept file: data channel not open.", { muted: false });
      resetProgress(fromUserId);
      return;
    }

    try {
      peer.dataChannel.send(JSON.stringify({ type: "file-accept" }));
    } catch (err) {
      log(`Error sending file-accept: ${err.message || err}`, { muted: false });
      resetProgress(fromUserId);
      return;
    }

    const incomingFile = incomingFiles.get(fromUserId);
    if (incomingFile) {
      const transfer = {
        direction: "receive",
        fileName: incomingFile.name,
        size: incomingFile.size,
        bytes: 0,
        startedAt: performance.now(),
        cancelled: false,
      };
      activeTransfers.set(fromUserId, transfer);
      updateProgressUI();
    }
  });

  rejectFileBtn.addEventListener("click", () => {
    const fromUserId = modalBackdrop.dataset.fromUserId;
    closeIncomingFileModal();
    if (fromUserId) {
      const peer = peerConnections.get(fromUserId);
      if (peer && peer.dataChannel && peer.dataChannel.readyState === "open") {
      try {
          peer.dataChannel.send(JSON.stringify({ type: "file-reject" }));
      } catch (err) {
        log(`Error sending file-reject: ${err.message || err}`, { muted: false });
      }
    }
    log("You rejected the incoming file.", { muted: false });
      resetProgress(fromUserId);
    }
  });

  copyLinkBtn.addEventListener("click", async () => {
    if (!localRoomCode) return;
    await fetchServerBaseUrl();
    const joinUrl = generateJoinUrl(localRoomCode);
    navigator.clipboard
      .writeText(joinUrl)
      .then(() => {
        log("Join link copied to clipboard!");
      })
      .catch((err) => {
        log("Failed to copy link.", { muted: false });
        console.error(err);
      });
  });

  // Auto-join from URL parameter
  window.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get("room");
    if (roomParam && /^\d{6}$/.test(roomParam)) {
      roomCodeInput.value = roomParam;
      // Auto-focus the join button or auto-join after a short delay
      setTimeout(() => {
        if (userNameInput.value.trim() === "") {
          userNameInput.focus();
        } else {
          joinRoomBtn.click();
        }
      }, 500);
    }
  });

  window.addEventListener("beforeunload", () => {
    try {
      if (signalingSocket) signalingSocket.close();
    } catch (e) {
      // ignore
    }
    peerConnections.forEach((peer) => {
    try {
        if (peer.dataChannel) peer.dataChannel.close();
        if (peer.peerConnection) peer.peerConnection.close();
    } catch (e) {
      // ignore
    }
    });
  });
})();
