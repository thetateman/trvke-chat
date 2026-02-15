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
