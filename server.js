const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const cookieParser = require('cookie-parser');
const path = require('path');

app.use(cookieParser());
app.use(express.static('public'));
app.use(express.json());

// База данных в памяти
let users = [];
let messages = [];
let activeCalls = [];

// Предустановленный админ
const ADMIN_USER = {
    id: 'prisanok',
    password: 'prisanok',
    name: 'prisanok',
    isAdmin: true,
    online: false,
    avatar: '👑'
};

users.push(ADMIN_USER);

// Сохранение в файл (для персистентности)
const fs = require('fs');
const DATA_FILE = './data.json';

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users, messages }, null, 2));
}

function loadData() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        users = data.users;
        messages = data.messages;
        // Убедимся что админ есть
        if (!users.find(u => u.id === 'prisanok')) {
            users.push(ADMIN_USER);
        }
    } catch(e) { console.log('No save file'); }
}

loadData();
setInterval(saveData, 5000);

// API для регистрации/логина
app.post('/auth', (req, res) => {
    const { id, password, name } = req.body;
    let user = users.find(u => u.id === id);
    
    if (user) {
        if (user.password && user.password !== password) {
            return res.json({ error: 'Неверный пароль' });
        }
    } else {
        if (users.find(u => u.id === id)) {
            return res.json({ error: 'ID уже существует' });
        }
        user = {
            id,
            password,
            name: name || id,
            isAdmin: false,
            online: false,
            avatar: '👤',
            friends: []
        };
        users.push(user);
    }
    
    res.cookie('userId', user.id, { maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { id: user.id, name: user.name, isAdmin: user.isAdmin } });
});

app.get('/logout', (req, res) => {
    res.clearCookie('userId');
    res.json({ success: true });
});

app.get('/me', (req, res) => {
    const userId = req.cookies.userId;
    const user = users.find(u => u.id === userId);
    if (user) {
        res.json({ user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
    } else {
        res.json({ user: null });
    }
});

// Socket.IO реальное время
io.use((socket, next) => {
    const userId = socket.handshake.auth.userId;
    if (userId) {
        socket.userId = userId;
        next();
    } else {
        next(new Error("unauthorized"));
    }
});

io.on('connection', (socket) => {
    const userId = socket.userId;
    let currentUser = users.find(u => u.id === userId);
    if (!currentUser) return socket.disconnect();
    
    currentUser.online = true;
    currentUser.socketId = socket.id;
    
    // Отправляем историю
    socket.emit('messages', messages);
    io.emit('users_update', users.map(u => ({ id: u.id, name: u.name, isAdmin: u.isAdmin, online: u.online, avatar: u.avatar })));
    
    // Новое сообщение
    socket.on('send_message', (data) => {
        const msg = {
            id: Date.now(),
            userId: currentUser.id,
            userName: currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name,
            text: data.text,
            time: new Date().toLocaleTimeString(),
            isAdmin: currentUser.isAdmin
        };
        messages.push(msg);
        if (messages.length > 200) messages.shift();
        io.emit('new_message', msg);
        saveData();
    });
    
    // Удаление сообщений (только админ)
    socket.on('delete_message', (msgId) => {
        if (currentUser.isAdmin) {
            messages = messages.filter(m => m.id != msgId);
            io.emit('messages', messages);
            saveData();
        }
    });
    
    // Обработка звонков
    socket.on('call_user', (data) => {
        const targetUser = users.find(u => u.id === data.targetId);
        if (targetUser && targetUser.online) {
            io.to(targetUser.socketId).emit('incoming_call', {
                from: currentUser.id,
                fromName: currentUser.name,
                isAdmin: currentUser.isAdmin
            });
            activeCalls.push({ from: currentUser.id, to: data.targetId, fromSocket: socket.id, toSocket: targetUser.socketId });
        } else {
            socket.emit('call_error', 'Пользователь не в сети');
        }
    });
    
    socket.on('accept_call', (data) => {
        const call = activeCalls.find(c => c.from === data.fromId);
        if (call) {
            io.to(call.fromSocket).emit('call_accepted', { to: currentUser.id, toName: currentUser.name });
            socket.emit('call_started', { with: call.from });
        }
    });
    
    socket.on('reject_call', (data) => {
        const call = activeCalls.find(c => c.from === data.fromId);
        if (call) {
            io.to(call.fromSocket).emit('call_rejected');
            activeCalls = activeCalls.filter(c => c !== call);
        }
    });
    
    socket.on('end_call', (data) => {
        const call = activeCalls.find(c => c.from === data.withId || c.to === data.withId);
        if (call) {
            io.to(call.fromSocket).emit('call_ended');
            io.to(call.toSocket).emit('call_ended');
            activeCalls = activeCalls.filter(c => c !== call);
        }
    });
    
    // WebRTC сигналинг
    socket.on('webrtc_offer', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target && target.online) {
            io.to(target.socketId).emit('webrtc_offer', { offer: data.offer, from: currentUser.id });
        }
    });
    
    socket.on('webrtc_answer', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target && target.online) {
            io.to(target.socketId).emit('webrtc_answer', { answer: data.answer, from: currentUser.id });
        }
    });
    
    socket.on('webrtc_ice', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target && target.online) {
            io.to(target.socketId).emit('webrtc_ice', { candidate: data.candidate, from: currentUser.id });
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            currentUser.online = false;
            io.emit('users_update', users.map(u => ({ id: u.id, name: u.name, isAdmin: u.isAdmin, online: u.online, avatar: u.avatar })));
        }
    });
});

server.listen(3000, () => {
    console.log('🚀 UNBOUND сервер запущен на http://localhost:3000');
    console.log('📱 Админ: prisanok / prisanok');
});
