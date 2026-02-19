const usernameModal = document.getElementById('username-modal');
const usernameForm = document.getElementById('username-form');
const usernameInput = document.getElementById('username-input');
const groupLobby = document.getElementById('group-lobby');
const joinCodeInput = document.getElementById('join-code-input');
const joinGroupButton = document.getElementById('join-group-button');
const joinError = document.getElementById('join-error');
const groupNameInput = document.getElementById('group-name-input');
const createGroupButton = document.getElementById('create-group-button');
const chatContainer = document.getElementById('chat-container');
const roomName = document.getElementById('room-name');
const groupCodeBadge = document.getElementById('group-code');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const statusIndicator = document.getElementById('status-indicator');

const uploadButton = document.getElementById('upload-button');
const uploadModal = document.getElementById('upload-modal');
const uploadModalClose = document.getElementById('upload-modal-close');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const attachmentPreview = document.getElementById('attachment-preview');
const settingsButton = document.getElementById('settings-button');
const settingsDropdown = document.getElementById('settings-dropdown');
const copyInviteButton = document.getElementById('copy-invite');
const leaveGroupButton = document.getElementById('leave-group');
const editProfileButton = document.getElementById('edit-profile');

const USERNAME_COLORS = [
  '#e8a04a', '#d4783c', '#c95d3a', '#e6c84d',
  '#d69b45', '#cf6842', '#e0b347', '#c4543d',
  '#dba84e', '#d17a3f', '#cb6540', '#e3c44b',
];

function getUsernameColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
}

let ws = null;
let username = '';
let intentionalClose = false;
let pendingFiles = [];
let isSending = false;
let lastTimestamp = 0;
let currentGroupCode = null;

// Voice call state
let myClientId = null;
let localStream = null;
let peerConnections = new Map(); // clientId → RTCPeerConnection
let isMuted = false;
let isInCall = false;

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const urlParams = new URLSearchParams(window.location.search);
const inviteCode = urlParams.get('group');

const savedUsername = localStorage.getItem('username');
if (savedUsername) {
  username = savedUsername;
  usernameModal.classList.add('hidden');
  connectWebSocket(username);
}

usernameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) return;
  if (ws) {
    changeUsername(name);
    usernameModal.classList.add('hidden');
  } else {
    joinWithUsername(name);
  }
});

function joinWithUsername(name) {
  username = name;
  localStorage.setItem('username', username);
  usernameModal.classList.add('hidden');
  connectWebSocket(username);
}

function showLobby() {
  chatContainer.classList.add('hidden');
  groupLobby.classList.remove('hidden');
  joinError.classList.add('hidden');
  joinCodeInput.value = inviteCode || '';
  joinCodeInput.focus();
}

function enterChat(code, name, messages) {
  currentGroupCode = code;
  groupLobby.classList.add('hidden');
  chatContainer.classList.remove('hidden');
  roomName.textContent = name;
  groupCodeBadge.textContent = code;
  messagesDiv.innerHTML = '';
  lastTimestamp = 0;
  for (const msg of messages) {
    renderMessage(msg);
    if (msg.timestamp > lastTimestamp) lastTimestamp = msg.timestamp;
  }
  scrollToBottom();
  messageInput.focus();
  history.replaceState(null, '', `?group=${code}`);
}

// Settings dropdown
settingsButton.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsDropdown.classList.toggle('hidden');
});

document.addEventListener('click', () => {
  settingsDropdown.classList.add('hidden');
});

editProfileButton.addEventListener('click', () => {
  settingsDropdown.classList.add('hidden');
  usernameInput.value = username;
  usernameModal.classList.remove('hidden');
  usernameInput.focus();
});

copyInviteButton.addEventListener('click', () => {
  settingsDropdown.classList.add('hidden');
  if (currentGroupCode) {
    const link = `${window.location.origin}?group=${currentGroupCode}`;
    navigator.clipboard.writeText(link);
  }
});

leaveGroupButton.addEventListener('click', () => {
  settingsDropdown.classList.add('hidden');
  leaveVoiceCall();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'leave-group' }));
  }
  currentGroupCode = null;
  messagesDiv.innerHTML = '';
  lastTimestamp = 0;
  showLobby();
  history.replaceState(null, '', window.location.pathname);
});

groupCodeBadge.addEventListener('click', () => {
  if (currentGroupCode) {
    const link = `${window.location.origin}?group=${currentGroupCode}`;
    navigator.clipboard.writeText(link);
  }
});

// Lobby buttons
joinGroupButton.addEventListener('click', () => {
  const code = joinCodeInput.value.trim();
  if (!code) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'join-group', code, since: lastTimestamp }));
  }
});

joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGroupButton.click();
});

createGroupButton.addEventListener('click', () => {
  const name = groupNameInput.value.trim();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'create-group', name }));
  }
});

groupNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') createGroupButton.click();
});

function changeUsername(newName) {
  username = newName;
  localStorage.setItem('username', username);
  leaveVoiceCall();
  if (ws) {
    intentionalClose = true;
    ws.close();
  }
  messagesDiv.innerHTML = '';
  lastTimestamp = 0;
  connectWebSocket(username);
}

function connectWebSocket(name) {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}?username=${encodeURIComponent(name)}`);

  ws.addEventListener('open', () => {
    statusIndicator.classList.add('connected');
    // Auto-join group on reconnect or invite link
    if (currentGroupCode) {
      ws.send(JSON.stringify({ type: 'join-group', code: currentGroupCode, since: lastTimestamp }));
    } else if (inviteCode) {
      ws.send(JSON.stringify({ type: 'join-group', code: inviteCode, since: lastTimestamp }));
    } else {
      showLobby();
    }
  });

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'group-joined':
        enterChat(data.code, data.name, data.messages);
        break;
      case 'your-client-id':
        myClientId = data.clientId;
        break;
      case 'error':
        joinError.textContent = data.text;
        joinError.classList.remove('hidden');
        if (!currentGroupCode) showLobby();
        break;
      case 'chat':
        renderMessage(data);
        if (data.timestamp > lastTimestamp) lastTimestamp = data.timestamp;
        scrollToBottom();
        break;
      case 'system':
        renderSystemMessage(data.text);
        scrollToBottom();
        break;
      case 'voice-state':
        renderVoiceParticipants(data.participants);
        break;
      case 'voice-peers':
        // We just joined; make offers to all existing call members
        for (const peer of data.peers) {
          createPeerConnection(peer.clientId, peer.username, true);
        }
        break;
      case 'rtc-offer':
        handleOffer(data);
        break;
      case 'rtc-answer':
        handleAnswer(data);
        break;
      case 'rtc-ice':
        handleIceCandidate(data);
        break;
    }
  });

  ws.addEventListener('close', () => {
    statusIndicator.classList.remove('connected');
    if (!intentionalClose) {
      if (currentGroupCode) {
        renderSystemMessage('Connection lost. Reconnecting...');
      }
      setTimeout(() => connectWebSocket(name), 3000);
    }
    intentionalClose = false;
  });
}

function renderFileAttachment(url, container) {
  const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(url);
  const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(url);
  if (isVideo) {
    const video = document.createElement('video');
    video.className = 'message-media';
    video.src = url + '#t=0.001';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('loadedmetadata', scrollToBottom);
    container.appendChild(video);
  } else if (isImage) {
    const img = document.createElement('img');
    img.className = 'message-media';
    img.src = url;
    img.alt = 'Shared image';
    img.addEventListener('load', scrollToBottom);
    img.addEventListener('click', () => window.open(url, '_blank'));
    container.appendChild(img);
  } else {
    const link = document.createElement('a');
    link.className = 'message-file';
    link.href = url;
    link.download = '';
    const rawName = url.split('/').pop();
    link.textContent = rawName.replace(/^[a-f0-9]+-/, '') || 'file';
    container.appendChild(link);
  }
}

function renderMessage({ username: user, text, timestamp, files, image }) {
  const div = document.createElement('div');
  div.className = 'message';

  const nameSpan = document.createElement('span');
  nameSpan.className = 'username';
  nameSpan.textContent = user;
  nameSpan.style.color = getUsernameColor(user);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';

  if (text) {
    const textSpan = document.createElement('span');
    textSpan.className = 'text';
    textSpan.textContent = text;
    contentDiv.appendChild(textSpan);
  }

  // Support files array (new) and single image field (backward compat)
  const fileList = files || (image ? [image] : []);
  for (const url of fileList) {
    renderFileAttachment(url, contentDiv);
  }

  const timeSpan = document.createElement('span');
  timeSpan.className = 'timestamp';
  timeSpan.textContent = new Date(timestamp).toLocaleTimeString('en-US', {hour: '2-digit', minute:'2-digit'});

  div.appendChild(nameSpan);
  div.appendChild(contentDiv);
  div.appendChild(timeSpan);
  messagesDiv.appendChild(div);
}

function renderSystemMessage(text) {
  const div = document.createElement('div');
  div.className = 'system-message';
  div.textContent = text;
  messagesDiv.appendChild(div);
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// --- Voice Call ---

function renderVoiceParticipants(participants) {
  const voiceChannel = document.getElementById('voice-channel');
  const list = document.getElementById('voice-participants');
  list.innerHTML = '';
  if (participants.length === 0) {
    voiceChannel.classList.remove('active');
    return;
  }
  voiceChannel.classList.add('active');
  for (const p of participants) {
    const span = document.createElement('span');
    span.className = 'voice-participant';
    span.dataset.clientid = p.clientId;
    span.textContent = p.username;
    span.style.color = getUsernameColor(p.username);
    list.appendChild(span);
  }
}

function updateVoiceUI() {
  const joinBtn = document.getElementById('voice-join-btn');
  const muteBtn = document.getElementById('voice-mute-btn');
  if (isInCall) {
    joinBtn.textContent = 'Leave Call';
    joinBtn.classList.add('in-call');
    muteBtn.classList.remove('hidden');
    muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
    muteBtn.classList.toggle('muted', isMuted);
  } else {
    joinBtn.textContent = 'Join Call';
    joinBtn.classList.remove('in-call');
    muteBtn.classList.add('hidden');
  }
}

function createPeerConnection(remoteClientId, _remoteUsername, isOfferer) {
  if (peerConnections.has(remoteClientId)) return peerConnections.get(remoteClientId);

  const pc = new RTCPeerConnection(ICE_CONFIG);
  peerConnections.set(remoteClientId, pc);

  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.ontrack = (event) => {
    let audio = document.getElementById(`audio-${remoteClientId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${remoteClientId}`;
      audio.autoplay = true;
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'rtc-ice',
        toClientId: remoteClientId,
        candidate: event.candidate,
      }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      closePeerConnection(remoteClientId);
    }
  };

  if (isOfferer) {
    pc.onnegotiationneeded = async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'rtc-offer',
            toClientId: remoteClientId,
            sdp: pc.localDescription,
          }));
        }
      } catch (err) {
        console.error('Offer creation failed:', err);
      }
    };
  }

  return pc;
}

async function handleOffer(data) {
  const pc = createPeerConnection(data.fromClientId, data.fromUsername, false);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'rtc-answer',
        toClientId: data.fromClientId,
        sdp: pc.localDescription,
      }));
    }
  } catch (err) {
    console.error('Failed to handle offer:', err);
  }
}

async function handleAnswer(data) {
  const pc = peerConnections.get(data.fromClientId);
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } catch (err) {
    console.error('Failed to handle answer:', err);
  }
}

async function handleIceCandidate(data) {
  const pc = peerConnections.get(data.fromClientId);
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (err) {
    console.error('Failed to add ICE candidate:', err);
  }
}

function closePeerConnection(clientId) {
  const pc = peerConnections.get(clientId);
  if (pc) {
    pc.close();
    peerConnections.delete(clientId);
  }
  const audio = document.getElementById(`audio-${clientId}`);
  if (audio) audio.remove();
}

async function joinVoiceCall() {
  if (isInCall) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    renderSystemMessage('Microphone access denied.');
    return;
  }
  isInCall = true;
  isMuted = false;
  updateVoiceUI();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'voice-join' }));
  }
  startVoiceActivityDetection(localStream, myClientId);
}

function leaveVoiceCall() {
  if (!isInCall) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'voice-leave' }));
  }
  isInCall = false;
  isMuted = false;
  for (const clientId of [...peerConnections.keys()]) {
    closePeerConnection(clientId);
  }
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  updateVoiceUI();
}

function toggleMute() {
  if (!localStream) return;
  isMuted = !isMuted;
  for (const track of localStream.getAudioTracks()) {
    track.enabled = !isMuted;
  }
  updateVoiceUI();
}

function startVoiceActivityDetection(stream, clientId) {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  function tick() {
    if (!isInCall) { audioCtx.close(); return; }
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const speaking = avg > 15;
    const el = document.querySelector(`[data-clientid="${clientId}"]`);
    if (el) el.classList.toggle('speaking', speaking);
    requestAnimationFrame(tick);
  }
  tick();
}

document.getElementById('voice-join-btn').addEventListener('click', () => {
  if (isInCall) leaveVoiceCall(); else joinVoiceCall();
});

document.getElementById('voice-mute-btn').addEventListener('click', toggleMute);

async function sendMessage() {
  if (isSending) return;
  const text = messageInput.value.trim();
  if (!text && pendingFiles.length === 0) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const msg = { type: 'chat', text };

  if (pendingFiles.length > 0) {
    isSending = true;
    sendButton.disabled = true;
    sendButton.innerHTML = '<span class="spinner"></span>';
    try {
      const uploads = pendingFiles.map(async (pf) => {
        const formData = new FormData();
        formData.append('image', pf.file);
        const res = await fetch('/upload', { method: 'POST', body: formData });
        if (!res.ok) throw new Error('Upload failed');
        const { url } = await res.json();
        return url;
      });
      msg.files = await Promise.all(uploads);
    } catch {
      renderSystemMessage('Failed to upload files');
      isSending = false;
      sendButton.disabled = false;
      sendButton.textContent = 'Send';
      return;
    }
    isSending = false;
    sendButton.disabled = false;
    sendButton.textContent = 'Send';
    clearPendingFiles();
  }

  ws.send(JSON.stringify(msg));
  messageInput.value = '';
  messageInput.focus();
}

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

messagesDiv.addEventListener('touchstart', () => {
  messageInput.blur();
});

// File staging
function stageFile(file) {
  if (!file) return;
  const previewUrl = file.type.startsWith('image/') || file.type.startsWith('video/')
    ? URL.createObjectURL(file)
    : null;
  pendingFiles.push({ file, previewUrl });
  renderPreviews();
}

function removeFile(index) {
  const removed = pendingFiles.splice(index, 1)[0];
  if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
  renderPreviews();
}

function clearPendingFiles() {
  for (const pf of pendingFiles) {
    if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
  }
  pendingFiles = [];
  renderPreviews();
}

function renderPreviews() {
  attachmentPreview.innerHTML = '';
  if (pendingFiles.length === 0) {
    attachmentPreview.classList.add('hidden');
    return;
  }
  attachmentPreview.classList.remove('hidden');

  pendingFiles.forEach((pf, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'attachment-thumb';

    const isImage = pf.file.type.startsWith('image/');
    const isVideo = pf.file.type.startsWith('video/');

    if (isImage && pf.previewUrl) {
      const img = document.createElement('img');
      img.src = pf.previewUrl;
      thumb.appendChild(img);
    } else if (isVideo && pf.previewUrl) {
      const video = document.createElement('video');
      video.src = pf.previewUrl + '#t=0.001';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      thumb.appendChild(video);
    } else {
      const icon = document.createElement('div');
      icon.className = 'thumb-file-icon';
      icon.textContent = '\u{1F4CE}';
      thumb.appendChild(icon);
    }

    const name = document.createElement('div');
    name.className = 'thumb-name';
    name.textContent = pf.file.name;
    thumb.appendChild(name);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.addEventListener('click', () => removeFile(i));
    thumb.appendChild(removeBtn);

    attachmentPreview.appendChild(thumb);
  });
}

// Ctrl+V paste
messageInput.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file') {
      e.preventDefault();
      stageFile(item.getAsFile());
      return;
    }
  }
});

// Upload modal
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

uploadButton.addEventListener('click', () => {
  if (isTouchDevice) {
    fileInput.click();
  } else {
    uploadModal.classList.remove('hidden');
  }
});

uploadModalClose.addEventListener('click', () => {
  uploadModal.classList.add('hidden');
});

uploadModal.addEventListener('click', (e) => {
  if (e.target === uploadModal) {
    uploadModal.classList.add('hidden');
  }
});

dropZone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  for (const file of fileInput.files) {
    stageFile(file);
  }
  uploadModal.classList.add('hidden');
  fileInput.value = '';
});

// Window-level drag and drop
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  if (dragCounter === 1) {
    uploadModal.classList.remove('hidden');
  }
});

document.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) {
    uploadModal.classList.add('hidden');
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  uploadModal.classList.add('hidden');
  for (const file of e.dataTransfer.files) {
    stageFile(file);
  }
});
