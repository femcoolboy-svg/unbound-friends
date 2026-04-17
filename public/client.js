const socket = io({
    auth: { userId: getCookie('userId') }
});

let currentUser = null;
let localStream = null;
let peerConnection = null;
let currentCallWith = null;
let soundEnabled = true;

// Получение куки
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

// Установка куки
function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/`;
}

// Проверка авторизации
fetch('/me').then(res => res.json()).then(data => {
    if (data.user) {
        currentUser = data.user;
        showMainScreen();
        socket.auth = { userId: currentUser.id };
        socket.connect();
    } else {
        showAuthScreen();
    }
});

function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('mainScreen').classList.add('hidden');
}

function showMainScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('mainScreen').classList.remove('hidden');
    document.getElementById('userNameDisplay').innerHTML = currentUser.isAdmin ? 
        `${currentUser.name}[админ]` : currentUser.name;
    document.getElementById('userAvatar').innerHTML = currentUser.avatar || '👤';
    if (currentUser.isAdmin) {
        document.getElementById('userBadge').innerHTML = '<span class="admin-badge">👑 Админ</span>';
    }
}

// Авторизация
document.getElementById('authBtn').onclick = async () => {
    const id = document.getElementById('loginId').value.trim();
    const password = document.getElementById('loginPassword').value;
    const name = document.getElementById('loginName').value.trim();
    
    const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, password, name: name || id })
    });
    const data = await res.json();
    if (data.error) {
        alert(data.error);
    } else {
        currentUser = data.user;
        showMainScreen();
        socket.auth = { userId: currentUser.id };
        socket.connect();
        location.reload();
    }
};

// Выход
document.getElementById('logoutBtn').onclick = async () => {
    await fetch('/logout');
    document.cookie = 'userId=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    location.reload();
};

// Настройки
document.getElementById('settingsBtn').onclick = () => {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('settingsName').value = currentUser.name;
    document.getElementById('settingsAvatar').value = currentUser.avatar || '👤';
};

document.getElementById('closeSettingsBtn').onclick = () => {
    document.getElementById('settingsModal').classList.add('hidden');
};

document.getElementById('saveSettingsBtn').onclick = async () => {
    const newName = document.getElementById('settingsName').value;
    const newAvatar = document.getElementById('settingsAvatar').value;
    const newPassword = document.getElementById('settingsPassword').value;
    
    // Тут можно отправить на сервер обновление профиля
    if (newName) currentUser.name = newName;
    if (newAvatar) currentUser.avatar = newAvatar;
    
    document.getElementById('userNameDisplay').innerHTML = currentUser.isAdmin ? 
        `${currentUser.name}[админ]` : currentUser.name;
    document.getElementById('userAvatar').innerHTML = currentUser.avatar;
    document.getElementById('settingsModal').classList.add('hidden');
    alert('Профиль обновлён (перезайди для полного сохранения)');
};

// Звук уведомления
function playNotificationSound() {
    if (!soundEnabled) return;
    const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
    audio.volume = 0.3;
    audio.play().catch(e => console.log('Звук не воспроизвёлся'));
}

// Socket события
socket.on('connect', () => {
    console.log('Подключен к серверу');
});

socket.on('users_update', (users) => {
    const container = document.getElementById('usersContainer');
    const onlineUsers = users.filter(u => u.online && u.id !== currentUser.id);
    document.getElementById('onlineCount').innerText = onlineUsers.length;
    
    container.innerHTML = onlineUsers.map(user => `
        <div class="user-item" data-id="${user.id}">
            <div class="avatar" style="width: 36px; height: 36px; font-size: 20px;">${user.avatar || '👤'}</div>
            <div style="flex:1">
                <strong>${user.isAdmin ? `${user.name}[админ]` : user.name}</strong>
                <span class="online-indicator"></span>
            </div>
            <button class="call-user-btn" data-id="${user.id}" data-name="${user.name}">📞</button>
        </div>
    `).join('');
    
    document.querySelectorAll('.call-user-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const targetId = btn.getAttribute('data-id');
            const targetName = btn.getAttribute('data-name');
            startCall(targetId, targetName);
        };
    });
});

socket.on('messages', (msgs) => {
    const container = document.getElementById('messagesContainer');
    container.innerHTML = msgs.map(msg => `
        <div class="message ${msg.isAdmin ? 'admin' : ''}" data-id="${msg.id}">
            <div class="message-header">
                <strong>${msg.userName}</strong> • ${msg.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${msg.id}" style="float:right; background:none; border:none; color:red;">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
    `).join('');
    
    document.querySelectorAll('.delete-msg').forEach(btn => {
        btn.onclick = () => socket.emit('delete_message', parseInt(btn.getAttribute('data-id')));
    });
    
    container.scrollTop = container.scrollHeight;
});

socket.on('new_message', (msg) => {
    playNotificationSound();
    const container = document.getElementById('messagesContainer');
    container.insertAdjacentHTML('beforeend', `
        <div class="message ${msg.isAdmin ? 'admin' : ''}" data-id="${msg.id}">
            <div class="message-header">
                <strong>${msg.userName}</strong> • ${msg.time}
                ${currentUser?.isAdmin ? `<button class="delete-msg" data-id="${msg.id}" style="float:right;">🗑️</button>` : ''}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
    `);
    container.scrollTop = container.scrollHeight;
});

// Отправка сообщения
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
let pendingCall = null;

function startCall(targetId, targetName) {
    socket.emit('call_user', { targetId });
    pendingCall = { targetId, targetName };
    document.getElementById('callStatus').innerHTML = `📞 Звоним ${targetName}...`;
    document.getElementById('activeCallInfo').classList.remove('hidden');
}

socket.on('incoming_call', (data) => {
    playNotificationSound();
    document.getElementById('callerName').innerHTML = `${data.fromName}${data.isAdmin ? '[админ]' : ''}`;
    document.getElementById('incomingCall').classList.remove('hidden');
    pendingCall = { fromId: data.from, fromName: data.fromName };
});

document.getElementById('acceptCallBtn').onclick = async () => {
    if (pendingCall && pendingCall.fromId) {
        socket.emit('accept_call', { fromId: pendingCall.fromId });
        await initWebRTC(pendingCall.fromId, true);
        document.getElementById('incomingCall').classList.add('hidden');
        document.getElementById('callStatus').innerHTML = `🎙️ В звонке с ${pendingCall.fromName}`;
        document.getElementById('activeCallInfo').classList.remove('hidden');
    }
};

document.getElementById('rejectCallBtn').onclick = () => {
    if (pendingCall && pendingCall.fromId) {
        socket.emit('reject_call', { fromId: pendingCall.fromId });
        document.getElementById('incomingCall').classList.add('hidden');
        pendingCall = null;
    }
};

socket.on('call_accepted', async (data) => {
    document.getElementById('callStatus').innerHTML = `🎙️ В звонке с ${data.toName}`;
    if (pendingCall) {
        await initWebRTC(pendingCall.targetId, false);
    }
});

socket.on('call_rejected', () => {
    alert('Звонок отклонён');
    document.getElementById('activeCallInfo').classList.add('hidden');
    if (peerConnection) peerConnection.close();
});

socket.on('call_ended', () => {
    alert('Звонок завершён');
    endCall();
});

document.getElementById('hangupCallBtn').onclick = () => {
    if (currentCallWith) {
        socket.emit('end_call', { withId: currentCallWith });
        endCall();
    }
};

async function initWebRTC(targetId, isAnswer) {
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
    if (peerConnection) peerConnection.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    peerConnection = null;
    localStream = null;
    currentCallWith = null;
    document.getElementById('activeCallInfo').classList.add('hidden');
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Автообновление каждую секунду (проверка статуса)
setInterval(() => {
    if (currentUser) {
        fetch('/me').then(res => res.json()).then(data => {
            if (!data.user) location.reload();
        });
    }
}, 1000);
