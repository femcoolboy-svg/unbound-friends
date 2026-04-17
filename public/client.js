const socket = io({ auth: { userId: getCookie('userId') } });

let currentUser = null;
let localStream = null, peerConnection = null, currentCallWith = null;
let soundEnabled = true, pendingCall = null;
let currentCaptchaValue = 0;

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// ============ КАПЧА ============
async function refreshCaptcha() {
    const res = await fetch('/api/get-captcha', { method: 'POST' });
    const data = await res.json();
    currentCaptchaValue = data.captcha;
    document.getElementById('captchaNumber').innerHTML = currentCaptchaValue;
}
refreshCaptcha();
document.getElementById('refreshCaptchaBtn')?.addEventListener('click', refreshCaptcha);

// ============ ПЕРЕКЛЮЧЕНИЕ ВКЛАДОК ============
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('loginTab').classList.toggle('hidden', btn.dataset.tab !== 'login');
        document.getElementById('registerTab').classList.toggle('hidden', btn.dataset.tab !== 'register');
    };
});

// ============ ЛОГИН ============
document.getElementById('loginBtn').onclick = async () => {
    const id = document.getElementById('loginId').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!id || !password) return showError('Заполните все поля');
    
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password })
    });
    const data = await res.json();
    if (data.error) showError(data.error);
    else { currentUser = data.user; initApp(); }
};

// ============ РЕГИСТРАЦИЯ ============
document.getElementById('registerBtn').onclick = async () => {
    const id = document.getElementById('regId').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value;
    const captchaInput = document.getElementById('regCaptcha').value;
    
    if (!id || id.length < 3) return showError('ID от 3 символов');
    if (!password || password.length < 4) return showError('Пароль от 4 символов');
    if (!name) return showError('Введите имя');
    if (!captchaInput) return showError('Введите число с картинки');
    if (parseInt(captchaInput) !== currentCaptchaValue) return showError('Неверная капча');
    
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password, name, captchaInput: parseInt(captchaInput) })
    });
    const data = await res.json();
    if (data.error) showError(data.error);
    else { currentUser = data.user; initApp(); }
};

function showError(msg) {
    const err = document.getElementById('authError');
    err.textContent = msg;
    err.classList.remove('hidden');
    setTimeout(() => err.classList.add('hidden'), 3000);
}

function initApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainScreen').classList.remove('hidden');
    document.getElementById('userName').innerHTML = currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name;
    document.getElementById('userAvatar').innerHTML = currentUser.avatar || '👤';
    if (currentUser.isAdmin) document.getElementById('adminPanel').classList.remove('hidden');
    socket.auth = { userId: currentUser.id };
    socket.connect();
    loadAdminUsers();
}

// Проверка авторизации
fetch('/api/me').then(res => res.json()).then(data => {
    if (data.user) { currentUser = data.user; initApp(); socket.connect(); }
});

// Выход
document.getElementById('logoutBtn').onclick = async () => {
    await fetch('/api/logout');
    document.cookie = 'userId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    location.reload();
};

// Настройки
document.getElementById('settingsBtn').onclick = () => {
    document.getElementById('settingsName').value = currentUser.name;
    document.getElementById('settingsAvatar').value = currentUser.avatar || '👤';
    document.getElementById('settingsModal').classList.remove('hidden');
};
document.getElementById('closeSettings').onclick = () => document.getElementById('settingsModal').classList.add('hidden');
document.getElementById('saveSettings').onclick = async () => {
    const res = await fetch('/api/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('settingsName').value.trim(),
            avatar: document.getElementById('settingsAvatar').value.trim(),
            password: document.getElementById('settingsPassword').value
        })
    });
    const data = await res.json();
    if (data.success) {
        currentUser = data.user;
        document.getElementById('userName').innerHTML = currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name;
        document.getElementById('userAvatar').innerHTML = currentUser.avatar || '👤';
        document.getElementById('settingsModal').classList.add('hidden');
        alert('✅ Профиль обновлён');
    } else alert(data.error);
};

// Админ-панель
async function loadAdminUsers() {
    if (!currentUser?.isAdmin) return;
    const res = await fetch('/api/admin/users');
    const data = await res.json();
    if (data.users) {
        document.getElementById('banList').innerHTML = data.users.map(u => `
            <div class="ban-item">
                <span>${u.name} (${u.id}) ${u.online ? '🟢' : '⚫'}</span>
                ${u.isBanned ? 
                    `<button class="unban-btn" data-id="${u.id}">Разбанить</button>` :
                    `<button class="ban-btn" data-id="${u.id}">Забанить</button>`
                }
            </div>
        `).join('');
        document.querySelectorAll('.ban-btn').forEach(btn => {
            btn.onclick = async () => {
                await fetch('/api/admin/ban', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetId: btn.dataset.id })
                });
                loadAdminUsers();
            };
        });
        document.querySelectorAll('.unban-btn').forEach(btn => {
            btn.onclick = async () => {
                await fetch('/api/admin/unban', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ targetId: btn.dataset.id })
                });
                loadAdminUsers();
            };
        });
    }
}

// Звук уведомлений
function playSound() {
    if (!soundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.1;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.3);
        osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}
document.getElementById('soundToggle').onclick = () => {
    soundEnabled = !soundEnabled;
    document.getElementById('soundToggle').innerHTML = soundEnabled ? '🔊' : '🔇';
};

// Socket события
socket.on('connect', () => console.log('connected'));
socket.on('force_logout', () => { alert('⛔ Вы забанены'); location.reload(); });

socket.on('users_update', (users) => {
    const container = document.getElementById('usersList');
    const onlineUsers = users.filter(u => u.online && u.id !== currentUser?.id);
    document.getElementById('onlineCount').innerText = onlineUsers.length;
    if (onlineUsers.length === 0) {
        container.innerHTML = '<div class="empty">👻 Никого нет в сети</div>';
        return;
    }
    container.innerHTML = onlineUsers.map(u => `
        <div class="user-item">
            <span class="name">${u.displayName}</span>
            <button class="call-btn" data-id="${u.id}" data-name="${u.name}">📞</button>
        </div>
    `).join('');
    document.querySelectorAll('.call-btn').forEach(btn => {
        btn.onclick = () => startCall(btn.dataset.id, btn.dataset.name);
    });
});

socket.on('user_typing', (data) => {
    const el = document.getElementById('typingIndicator');
    if (data.isTyping && data.userId !== currentUser?.id) {
        el.innerHTML = `✍️ ${data.userName} печатает...`;
        el.classList.remove('hidden');
    } else el.classList.add('hidden');
});

socket.on('messages_history', (msgs) => {
    const container = document.getElementById('messages');
    if (!msgs.length) return;
    container.innerHTML = msgs.map(m => `
        <div class="message ${m.isAdmin ? 'admin' : ''}">
            <div class="message-header">
                <strong>${m.userName}</strong> • ${m.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${m.id}">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(m.text)}</div>
        </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
    document.querySelectorAll('.delete-msg').forEach(btn => {
        btn.onclick = () => socket.emit('delete_message', parseInt(btn.dataset.id));
    });
});

socket.on('new_message', (m) => {
    playSound();
    const container = document.getElementById('messages');
    const empty = container.querySelector('.empty-message');
    if (empty) empty.remove();
    container.insertAdjacentHTML('beforeend', `
        <div class="message ${m.isAdmin ? 'admin' : ''}">
            <div class="message-header">
                <strong>${m.userName}</strong> • ${m.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${m.id}">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(m.text)}</div>
        </div>
    `);
    container.scrollTop = container.scrollHeight;
    document.querySelectorAll('.delete-msg').forEach(btn => {
        btn.onclick = () => socket.emit('delete_message', parseInt(btn.dataset.id));
    });
});

socket.on('messages_update', (msgs) => {
    const container = document.getElementById('messages');
    container.innerHTML = msgs.map(m => `
        <div class="message ${m.isAdmin ? 'admin' : ''}">
            <div class="message-header">
                <strong>${m.userName}</strong> • ${m.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${m.id}">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(m.text)}</div>
        </div>
    `).join('');
});

// Отправка сообщений
document.getElementById('sendBtn').onclick = () => {
    const input = document.getElementById('messageInput');
    if (input.value.trim()) {
        socket.emit('send_message', { text: input.value });
        input.value = '';
    }
};
document.getElementById('messageInput').onkeypress = (e) => {
    if (e.key === 'Enter') document.getElementById('sendBtn').click();
};
let typingTimeout;
document.getElementById('messageInput').oninput = () => {
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', { isTyping: false }), 1000);
};

// Звонки
function startCall(targetId, targetName) {
    socket.emit('call_user', { targetId });
    pendingCall = { targetId, targetName };
    document.getElementById('callStatus').innerHTML = `📞 Звоним ${targetName}...`;
    document.getElementById('activeCall').classList.remove('hidden');
}

socket.on('incoming_call', (data) => {
    playSound();
    document.getElementById('callerName').innerHTML = data.fromName;
    document.getElementById('incomingCall').classList.remove('hidden');
    pendingCall = { fromId: data.from, fromName: data.fromName };
});

document.getElementById('acceptCall').onclick = async () => {
    if (pendingCall?.fromId) {
        socket.emit('accept_call', { fromId: pendingCall.fromId });
        await initWebRTC(pendingCall.fromId, true);
        document.getElementById('incomingCall').classList.add('hidden');
        document.getElementById('callStatus').innerHTML = `🎙️ В звонке с ${pendingCall.fromName}`;
        document.getElementById('activeCall').classList.remove('hidden');
        pendingCall = null;
    }
};

document.getElementById('rejectCall').onclick = () => {
    if (pendingCall?.fromId) socket.emit('reject_call', { fromId: pendingCall.fromId });
    document.getElementById('incomingCall').classList.add('hidden');
    pendingCall = null;
};

socket.on('call_accepted', async (data) => {
    document.getElementById('callStatus').innerHTML = `🎙️ В звонке с ${data.toName}`;
    if (pendingCall) {
        await initWebRTC(pendingCall.targetId, false);
        pendingCall = null;
    }
});

socket.on('call_rejected', () => { alert('❌ Звонок отклонён'); endCall(); });
socket.on('call_ended', () => { alert('🔴 Звонок завершён'); endCall(); });
socket.on('call_error', (msg) => { alert(msg); endCall(); });

document.getElementById('hangupBtn').onclick = () => {
    if (currentCallWith) socket.emit('end_call', { withId: currentCallWith });
    endCall();
};

async function initWebRTC(targetId, isAnswer) {
    try {
        const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(config);
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
        const remoteAudio = new Audio(); remoteAudio.autoplay = true;
        peerConnection.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) socket.emit('webrtc_ice', { targetId, candidate: e.candidate });
        };
        if (!isAnswer) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc_offer', { targetId, offer });
        }
        currentCallWith = targetId;
    } catch(e) { alert('❌ Ошибка доступа к микрофону'); }
}

socket.on('webrtc_offer', async (data) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc_answer', { targetId: data.from, answer });
    }
});
socket.on('webrtc_answer', async (data) => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});
socket.on('webrtc_ice', async (data) => {
    if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
});

function endCall() {
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    peerConnection = null; localStream = null; currentCallWith = null;
    document.getElementById('activeCall').classList.add('hidden');
    document.getElementById('incomingCall').classList.add('hidden');
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
