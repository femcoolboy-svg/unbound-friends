const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const cookieParser = require('cookie-parser');

app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

// ============ ДАННЫЕ ============
let users = [
    {
        id: 'prisanok',
        password: 'prisanok',
        name: 'prisanok',
        isAdmin: true,
        online: false,
        avatar: '👑',
        socketId: null,
        isBanned: false
    }
];

let messages = [];
let activeCalls = [];
let bannedUsers = []; // список забаненных ID

// Сохранение в файл
const fs = require('fs');
const DATA_FILE = './data.json';

function saveData() {
    try {
        const dataToSave = {
            users: users.map(u => ({ ...u, socketId: undefined })),
            messages,
            bannedUsers
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    } catch(e) { console.log('Save error:', e); }
}

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE));
            users = data.users.map(u => ({ ...u, online: false, socketId: null }));
            messages = data.messages || [];
            bannedUsers = data.bannedUsers || [];
            
            // Админ всегда существует и не забанен
            const admin = users.find(u => u.id === 'prisanok');
            if (admin) {
                admin.isAdmin = true;
                admin.isBanned = false;
            } else {
                users.unshift({
                    id: 'prisanok',
                    password: 'prisanok',
                    name: 'prisanok',
                    isAdmin: true,
                    online: false,
                    avatar: '👑',
                    socketId: null,
                    isBanned: false
                });
            }
        }
    } catch(e) { console.log('Load error:', e); }
}

loadData();
setInterval(saveData, 5000);

// ============ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ============
function generateCaptcha() {
    return Math.floor(Math.random() * 199) + 1; // от 1 до 199
}

function isNameTaken(name, excludeUserId = null) {
    return users.some(u => u.name.toLowerCase() === name.toLowerCase() && u.id !== excludeUserId);
}

// ============ API ============
app.post('/api/get-captcha', (req, res) => {
    const captcha = generateCaptcha();
    // Временно храним капчу в памяти (для простоты)
    if (!global.captchaStore) global.captchaStore = {};
    global.captchaStore[req.ip] = captcha;
    setTimeout(() => delete global.captchaStore[req.ip], 300000); // 5 минут
    res.json({ captcha });
});

app.post('/api/register', (req, res) => {
    const { id, password, name, captcha, userCaptcha } = req.body;
    
    // Проверка капчи
    const storedCaptcha = global.captchaStore?.[req.ip];
    if (!storedCaptcha || parseInt(userCaptcha) !== storedCaptcha) {
        return res.json({ error: 'Неверная капча' });
    }
    delete global.captchaStore[req.ip];
    
    // Валидация
    if (!id || id.trim().length < 3) return res.json({ error: 'ID от 3 символов' });
    if (!password || password.length < 4) return res.json({ error: 'Пароль от 4 символов' });
    if (!name || name.trim().length < 1) return res.json({ error: 'Введите имя' });
    if (users.find(u => u.id === id)) return res.json({ error: 'ID уже существует' });
    if (isNameTaken(name)) return res.json({ error: 'Это имя уже занято' });
    if (bannedUsers.includes(id)) return res.json({ error: 'Этот ID в бане' });
    
    const newUser = {
        id: id.trim(),
        password: password,
        name: name.trim(),
        isAdmin: false,
        online: false,
        avatar: '👤',
        socketId: null,
        isBanned: false
    };
    users.push(newUser);
    
    res.cookie('userId', newUser.id, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
    res.json({ success: true, user: { id: newUser.id, name: newUser.name, isAdmin: newUser.isAdmin, avatar: newUser.avatar } });
    saveData();
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    
    if (!id || !password) return res.json({ error: 'Заполните все поля' });
    
    const user = users.find(u => u.id === id);
    if (!user || user.password !== password) return res.json({ error: 'Неверный ID или пароль' });
    if (user.isBanned || bannedUsers.includes(user.id)) return res.json({ error: 'Вы забанены' });
    
    res.cookie('userId', user.id, { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, path: '/' });
    res.json({ success: true, user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
});

app.post('/api/update-profile', (req, res) => {
    const userId = req.cookies.userId;
    const { name, avatar, password } = req.body;
    const user = users.find(u => u.id === userId);
    
    if (!user) return res.json({ error: 'Пользователь не найден' });
    if (name && name.trim() && name !== user.name && isNameTaken(name, userId)) {
        return res.json({ error: 'Это имя уже занято' });
    }
    
    if (name && name.trim()) user.name = name.trim();
    if (avatar && avatar.trim()) user.avatar = avatar.trim().slice(0, 2);
    if (password && password.trim().length >= 4) user.password = password;
    
    saveData();
    res.json({ success: true, user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
});

// Админские методы
app.post('/api/admin/ban', (req, res) => {
    const userId = req.cookies.userId;
    const admin = users.find(u => u.id === userId);
    if (!admin || !admin.isAdmin) return res.json({ error: 'Нет прав' });
    
    const { targetId } = req.body;
    if (targetId === 'prisanok') return res.json({ error: 'Нельзя забанить админа' });
    
    const target = users.find(u => u.id === targetId);
    if (target) {
        target.isBanned = true;
        if (!bannedUsers.includes(targetId)) bannedUsers.push(targetId);
        
        // Кикаем с сокета
        if (target.socketId) {
            io.to(target.socketId).emit('force_logout', { reason: 'Вы были забанены' });
        }
        saveData();
        broadcastUsers();
        res.json({ success: true });
    } else {
        res.json({ error: 'Пользователь не найден' });
    }
});

app.post('/api/admin/unban', (req, res) => {
    const userId = req.cookies.userId;
    const admin = users.find(u => u.id === userId);
    if (!admin || !admin.isAdmin) return res.json({ error: 'Нет прав' });
    
    const { targetId } = req.body;
    const target = users.find(u => u.id === targetId);
    if (target) {
        target.isBanned = false;
        bannedUsers = bannedUsers.filter(id => id !== targetId);
        saveData();
        broadcastUsers();
        res.json({ success: true });
    } else {
        res.json({ error: 'Пользователь не найден' });
    }
});

app.get('/api/admin/users', (req, res) => {
    const userId = req.cookies.userId;
    const admin = users.find(u => u.id === userId);
    if (!admin || !admin.isAdmin) return res.json({ error: 'Нет прав' });
    
    const userList = users.filter(u => u.id !== 'prisanok').map(u => ({
        id: u.id,
        name: u.name,
        isBanned: u.isBanned || bannedUsers.includes(u.id),
        online: u.online
    }));
    res.json({ users: userList });
});

app.get('/api/me', (req, res) => {
    const userId = req.cookies.userId;
    if (!userId) return res.json({ user: null });
    const user = users.find(u => u.id === userId);
    if (user && (user.isBanned || bannedUsers.includes(user.id))) {
        res.clearCookie('userId');
        return res.json({ user: null, banned: true });
    }
    if (user) {
        res.json({ user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
    } else {
        res.clearCookie('userId');
        res.json({ user: null });
    }
});

app.get('/api/logout', (req, res) => {
    res.clearCookie('userId');
    res.json({ success: true });
});

// ============ SOCKET.IO ============
io.use((socket, next) => {
    const userId = socket.handshake.auth.userId;
    if (userId) {
        const user = users.find(u => u.id === userId);
        if (user && (user.isBanned || bannedUsers.includes(user.id))) {
            return next(new Error('Banned'));
        }
        socket.userId = userId;
        next();
    } else {
        next(new Error('Unauthorized'));
    }
});

io.on('connection', (socket) => {
    const userId = socket.userId;
    let currentUser = users.find(u => u.id === userId);
    
    if (!currentUser || currentUser.isBanned || bannedUsers.includes(currentUser.id)) {
        socket.disconnect();
        return;
    }
    
    currentUser.online = true;
    currentUser.socketId = socket.id;
    
    socket.emit('messages_history', messages);
    broadcastUsers();
    
    // Индикатор набора текста
    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', {
            userId: currentUser.id,
            userName: currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name,
            isTyping: data.isTyping
        });
    });
    
    // Сообщения
    socket.on('send_message', (data) => {
        if (!data.text || !data.text.trim()) return;
        const message = {
            id: Date.now(),
            userId: currentUser.id,
            userName: currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name,
            text: data.text.trim(),
            time: new Date().toLocaleTimeString(),
            isAdmin: currentUser.isAdmin
        };
        messages.push(message);
        if (messages.length > 500) messages.shift();
        io.emit('new_message', message);
        saveData();
    });
    
    socket.on('delete_message', (messageId) => {
        if (currentUser.isAdmin) {
            messages = messages.filter(m => m.id !== messageId);
            io.emit('messages_update', messages);
            saveData();
        }
    });
    
    // Звонки
    socket.on('call_user', (data) => {
        const targetUser = users.find(u => u.id === data.targetId);
        if (!targetUser || !targetUser.online || !targetUser.socketId) {
            socket.emit('call_error', 'Пользователь не в сети');
            return;
        }
        if (targetUser.isBanned || bannedUsers.includes(targetUser.id)) {
            socket.emit('call_error', 'Пользователь забанен');
            return;
        }
        const existingCall = activeCalls.find(c => c.to === targetUser.id || c.from === targetUser.id);
        if (existingCall) {
            socket.emit('call_error', 'Пользователь уже в звонке');
            return;
        }
        const call = {
            id: Date.now(),
            from: currentUser.id,
            fromName: currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name,
            to: targetUser.id,
            fromSocket: socket.id,
            toSocket: targetUser.socketId
        };
        activeCalls.push(call);
        io.to(targetUser.socketId).emit('incoming_call', {
            from: currentUser.id,
            fromName: currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name,
            fromAvatar: currentUser.avatar
        });
    });
    
    socket.on('accept_call', (data) => {
        const call = activeCalls.find(c => c.from === data.fromId);
        if (call) {
            io.to(call.fromSocket).emit('call_accepted', { to: currentUser.id, toName: currentUser.isAdmin ? `${currentUser.name}[админ]` : currentUser.name });
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
    
    // WebRTC
    socket.on('webrtc_offer', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target && target.online && target.socketId) {
            io.to(target.socketId).emit('webrtc_offer', { offer: data.offer, from: currentUser.id });
        }
    });
    
    socket.on('webrtc_answer', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target && target.online && target.socketId) {
            io.to(target.socketId).emit('webrtc_answer', { answer: data.answer, from: currentUser.id });
        }
    });
    
    socket.on('webrtc_ice', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (target && target.online && target.socketId) {
            io.to(target.socketId).emit('webrtc_ice', { candidate: data.candidate, from: currentUser.id });
        }
    });
    
    socket.on('disconnect', () => {
        if (currentUser) {
            currentUser.online = false;
            currentUser.socketId = null;
            broadcastUsers();
            activeCalls = activeCalls.filter(c => c.from !== currentUser.id && c.to !== currentUser.id);
        }
    });
});

function broadcastUsers() {
    const usersList = users.filter(u => !u.isBanned && !bannedUsers.includes(u.id)).map(u => ({
        id: u.id,
        name: u.name,
        isAdmin: u.isAdmin,
        online: u.online,
        avatar: u.avatar,
        displayName: u.isAdmin ? `${u.name}[админ]` : u.name
    }));
    io.emit('users_update', usersList);
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 UNBOUND сервер запущен на http://localhost:${PORT}`);
    console.log(`👑 Админ: prisanok / prisanok\n`);
});
