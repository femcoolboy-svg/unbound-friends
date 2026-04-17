const socket = io({
    auth: { userId: getCookie('userId') }
});

let currentUser = null;
let localStream = null;
let peerConnection = null;
let currentCallWith = null;
let soundEnabled = true;
let pendingCall = null;
let typingTimeout = null;

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Мобильное меню
let sidebarOpen = false;
let callsPanelOpen = false;

document.getElementById('showCallsBtn')?.addEventListener('click', () => {
    const panel = document.querySelector('.calls-panel');
    panel.classList.add('open');
    callsPanelOpen = true;
});

document.getElementById('closeCallsBtn')?.addEventListener('click', () => {
    const panel = document.querySelector('.calls-panel');
    panel.classList.remove('open');
    callsPanelOpen = false;
});

// Переключение вкладок
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('loginTab').classList.add('hidden');
        document.getElementById('registerTab').classList.add('hidden');
        if (btn.dataset.tab === 'login') {
            document.getElementById('loginTab').classList.remove('hidden');
        } else {
            document.getElementById('registerTab').classList.remove('hidden');
        }
    };
});

// Логин
document.getElementById('loginBtn').onclick = async () => {
    const id = document.getElementById('loginId').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    if (!id || !password) {
        showError('Заполните все поля');
        return;
    }
    
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password })
    });
    const data = await res.json();
    if (data.error) {
        showError(data.error);
    } else {
        currentUser = data.user;
        initApp();
    }
};

// Регистрация
document.getElementById('registerBtn').onclick = async () => {
    const id = document.getElementById('regId').value.trim();
    const name = document.getElementById('regName').value.trim();
    const password = document.getElementById('regPassword').value;
    
    if (!id || id.length < 3) {
        showError('ID должен быть от 3 символов');
        return;
    }
    if (!password || password.length < 4) {
        showError('Пароль от 4 символов');
        return;
    }
    if (!name) {
        showError('Введите имя');
        return;
    }
    
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password, name })
    });
    const data = await res.json();
    if (data.error) {
        showError(data.error);
    } else {
        currentUser = data.user;
        initApp();
    }
};

function showError(msg) {
    const errorDiv = document.getElementById('authError');
    errorDiv.textContent = msg;
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 3000);
}

function initApp() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainScreen').classList.remove('hidden');
    
    const displayName = currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name;
    document.getElementById('userNameDisplay').innerHTML = displayName;
    document.getElementById('userAvatar').innerHTML = currentUser.avatar || '👤';
    
    if (currentUser.isAdmin) {
        document.getElementById('userBadge').innerHTML = '<span class="admin-badge">👑 АДМИН</span>';
    }
    
    socket.auth = { userId: currentUser.id };
    socket.connect();
}

// Проверка авторизации
fetch('/api/me').then(res => res.json()).then(data => {
    if (data.user) {
        currentUser = data.user;
        initApp();
        socket.connect();
    }
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

document.getElementById('closeSettingsBtn').onclick = () => {
    document.getElementById('settingsModal').classList.add('hidden');
};
document.getElementById('cancelSettingsBtn').onclick = () => {
    document.getElementById('settingsModal').classList.add('hidden');
};

document.getElementById('saveSettingsBtn').onclick = async () => {
    const newName = document.getElementById('settingsName').value.trim();
    const newAvatar = document.getElementById('settingsAvatar').value.trim();
    const newPassword = document.getElementById('settingsPassword').value;
    
    const res = await fetch('/api/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, avatar: newAvatar, password: newPassword })
    });
    const data = await res.json();
    if (data.success) {
        currentUser = data.user;
        const displayName = currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name;
        document.getElementById('userNameDisplay').innerHTML = displayName;
        document.getElementById('userAvatar').innerHTML = currentUser.avatar || '👤';
        document.getElementById('settingsModal').classList.add('hidden');
        alert('✅ Профиль обновлён');
    }
};

// Индикатор набора текста
const messageInput = document.getElementById('messageInput');

messageInput.addEventListener('input', () => {
    socket.emit('typing', { isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { isTyping: false });
    }, 1000);
});

// Звук уведомлений (улучшенный)
let audioContext = null;

function playNotificationSound() {
    if (!soundEnabled) return;
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.frequency.value = 880;
        gainNode.gain.value = 0.15;
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.4);
        oscillator.stop(audioContext.currentTime + 0.4);
    } catch(e) { console.log('Audio error'); }
}

document.getElementById('toggleSoundBtn').onclick = () => {
    soundEnabled = !soundEnabled;
    document.getElementById('toggleSoundBtn').innerHTML = soundEnabled ? '🔊' : '🔇';
};

// Socket события
socket.on('connect', () => console.log('✅ Connected'));

socket.on('users_update', (users) => {
    const container = document.getElementById('usersContainer');
    const onlineUsers = users.filter(u => u.online && u.id !== currentUser?.id);
    document.getElementById('onlineCount').innerText = onlineUsers.length;
    
    if (onlineUsers.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.5;">👻 Никого нет в сети</div>';
        return;
    }
    
    container.innerHTML = onlineUsers.map(user => `
        <div class="user-item" data-id="${user.id}">
            <div class="user-item-avatar">${user.avatar || '👤'}</div>
            <div class="user-item-info">
                <div class="user-item-name">
                    ${user.isAdmin ? `${user.name}[админ]` : user.name}
                    <span class="online-dot"></span>
                </div>
            </div>
            <button class="call-btn" data-id="${user.id}" data-name="${user.name}">📞</button>
        </div>
    `).join('');
    
    document.querySelectorAll('.call-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            startCall(btn.dataset.id, btn.dataset.name);
        };
    });
});

socket.on('user_typing', (data) => {
    const typingIndicator = document.getElementById('typingIndicator');
    if (data.isTyping && data.userId !== currentUser?.id) {
        typingIndicator.innerHTML = `${data.userName} печатает...`;
        typingIndicator.classList.remove('hidden');
    } else {
        typingIndicator.classList.add('hidden');
    }
});

socket.on('messages_history', (msgs) => {
    const container = document.getElementById('messagesContainer');
    if (!msgs.length) return;
    container.innerHTML = msgs.map(msg => `
        <div class="message ${msg.isAdmin ? 'admin' : ''}" data-id="${msg.id}">
            <div class="message-header">
                <strong>${msg.userName}</strong> • ${msg.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${msg.id}">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
    
    document.querySelectorAll('.delete-msg').forEach(btn => {
        btn.onclick = () => socket.emit('delete_message', parseInt(btn.dataset.id));
    });
});

socket.on('new_message', (msg) => {
    playNotificationSound();
    const container = document.getElementById('messagesContainer');
    const welcome = container.querySelector('.welcome-message');
    if (welcome) welcome.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${msg.isAdmin ? 'admin' : ''} new`;
    messageDiv.innerHTML = `
        <div class="message-header">
            <strong>${msg.userName}</strong> • ${msg.time}
            ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${msg.id}">🗑️</button>` : ''}
        </div>
        <div class="message-text">${escapeHtml(msg.text)}</div>
    `;
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;
    
    setTimeout(() => messageDiv.classList.remove('new'), 500);
    
    document.querySelectorAll('.delete-msg').forEach(btn => {
        btn.onclick = () => socket.emit('delete_message', parseInt(btn.dataset.id));
    });
});

socket.on('messages_update', (msgs) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = msgs.map(msg => `
        <div class="message ${msg.isAdmin ? 'admin' : ''}" data-id="${msg.id}">
            <div class="message-header">
                <strong>${msg.userName}</strong> • ${msg.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${msg.id}">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
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

// Звонки
function startCall(targetId, targetName) {
    socket.emit('call_user', { targetId });
    pendingCall = { targetId, targetName };
    document.getElementById('callStatus').innerHTML = `📞 Звоним ${targetName}...`;
    document.getElementById('activeCallInfo').classList.remove('hidden');
}

socket.on('incoming_call', (data) => {
    playNotificationSound();
    document.getElementById('callerName').innerHTML = data.fromName;
    document.getElementById('incomingCall').classList.remove('hidden');
    pendingCall = { fromId: data.from, fromName: data.fromName };
});

document.getElementById('acceptCallBtn').onclick = async () => {
    if (pendingCall?.fromId) {
        socket.emit('accept_call', { fromId: pendingCall.fromId });
        await initWebRTC(pendingCall.fromId, true);
        document.getElementById('incomingCall').classList.add('hidden');
        document.getElementById('callStatus').innerHTML = `🎙️ В звонке с ${pendingCall.fromName}`;
        document.getElementById('activeCallInfo').classList.remove('hidden');
        pendingCall = null;
    }
};

document.getElementById('rejectCallBtn').onclick = () => {
    if (pendingCall?.fromId) {
        socket.emit('reject_call', { fromId: pendingCall.fromId });
        document.getElementById('incomingCall').classList.add('hidden');
        pendingCall = null;
    }
};

socket.on('call_accepted', async (data) => {
    document.getElementById('callStatus').innerHTML = `🎙️ В звонке с ${data.toName}`;
    if (pendingCall) {
        await initWebRTC(pendingCall.targetId, false);
        pendingCall = null;
    }
});

socket.on('call_rejected', () => {
    alert('❌ Звонок отклонён');
    document.getElementById('activeCallInfo').classList.add('hidden');
    endCall();
});

socket.on('call_ended', () => {
    alert('🔴 Звонок завершён');
    endCall();
});

socket.on('call_error', (msg) => {
    alert(msg);
    document.getElementById('activeCallInfo').classList.add('hidden');
});

document.getElementById('hangupCallBtn').onclick = () => {
    if (currentCallWith) {
        socket.emit('end_call', { withId: currentCallWith });
        endCall();
    }
};

async function initWebRTC(targetId, isAnswer) {
    try {
        const configuration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        peerConnection = new RTCPeerConnection(configuration);
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        
        const remoteAudio = new Audio();
        remoteAudio.autoplay = true;
        peerConnection.ontrack = (event) => {
            remoteAudio.srcObject = event.streams[0];
        };
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc_ice', { targetId, candidate: event.candidate });
            }
        };
        
        if (!isAnswer) {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc_offer', { targetId, offer });
        }
        
        currentCallWith = targetId;
    } catch(e) {
        console.error('WebRTC error:', e);
        alert('❌ Ошибка доступа к микрофону. Разрешите доступ.');
    }
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
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
});

socket.on('webrtc_ice', async (data) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
});

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    currentCallWith = null;
    document.getElementById('activeCallInfo').classList.add('hidden');
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

// Закрытие мобильных панелей при клике вне
document.addEventListener('click', (e) => {
    if (sidebarOpen && !e.target.closest('.sidebar') && !e.target.closest('.show-sidebar-btn')) {
        document.querySelector('.sidebar').classList.remove('open');
        sidebarOpen = false;
    }
    if (callsPanelOpen && !e.target.closest('.calls-panel') && !e.target.closest('.show-calls-btn')) {
        document.querySelector('.calls-panel').classList.remove('open');
        callsPanelOpen = false;
    }
});
