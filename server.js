const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Хранилище для аватарок
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Получение IP
app.set('trust proxy', true);
function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
}

// ============ ДАННЫЕ ============
let users = [
    {
        id: 'prisanok',
        password: 'prisanok',
        name: 'prisanok',
        isAdmin: true,
        online: false,
        avatar: '/uploads/default.png',
        socketId: null,
        isBanned: false,
        allowedIp: '62.140.249.69',
        friends: []
    }
];

let messages = [];
let activeCalls = [];
let bannedUsers = [];

const DATA_FILE = './data.json';

function saveData() {
    try {
        const toSave = {
            users: users.map(u => ({ ...u, socketId: undefined })),
            messages,
            bannedUsers
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2));
    } catch(e) { console.log('Save error'); }
}

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE));
            users = data.users.map(u => ({ ...u, online: false, socketId: null }));
            messages = data.messages || [];
            bannedUsers = data.bannedUsers || [];
            // Убедимся, что админ есть
            if (!users.find(u => u.id === 'prisanok')) {
                users.unshift({
                    id: 'prisanok', password: 'prisanok', name: 'prisanok',
                    isAdmin: true, online: false, avatar: '/uploads/default.png',
                    socketId: null, isBanned: false, allowedIp: '62.140.249.69', friends: []
                });
            } else {
                const admin = users.find(u => u.id === 'prisanok');
                admin.isAdmin = true;
                admin.allowedIp = '62.140.249.69';
                if (!admin.avatar) admin.avatar = '/uploads/default.png';
            }
        }
    } catch(e) { console.log('Load error'); }
}
loadData();
setInterval(saveData, 5000);

// ============ КАПЧА ============
let captchaStore = {};
app.post('/api/get-captcha', (req, res) => {
    const captcha = Math.floor(Math.random() * 199) + 1;
    captchaStore[req.ip] = captcha;
    setTimeout(() => delete captchaStore[req.ip], 300000);
    res.json({ captcha });
});

function isNameTaken(name, excludeId = null) {
    return users.some(u => u.name.toLowerCase() === name.toLowerCase() && u.id !== excludeId);
}

// ============ API ============
app.post('/api/register', (req, res) => {
    const { id, password, name, captchaInput } = req.body;
    const stored = captchaStore[req.ip];
    if (!stored || parseInt(captchaInput) !== stored) return res.json({ error: 'Неверная капча' });
    delete captchaStore[req.ip];
    if (!id || id.length < 3) return res.json({ error: 'ID от 3 символов' });
    if (!password || password.length < 4) return res.json({ error: 'Пароль от 4 символов' });
    if (!name) return res.json({ error: 'Введите имя' });
    if (users.find(u => u.id === id)) return res.json({ error: 'ID уже существует' });
    if (isNameTaken(name)) return res.json({ error: 'Имя уже занято' });
    if (bannedUsers.includes(id)) return res.json({ error: 'ID в бане' });
    
    const newUser = {
        id, password, name, isAdmin: false, online: false,
        avatar: '/uploads/default.png', socketId: null, isBanned: false, friends: []
    };
    users.push(newUser);
    res.cookie('userId', id, { maxAge: 30*24*60*60*1000, httpOnly: true });
    res.json({ success: true, user: { id, name, isAdmin: false, avatar: '/uploads/default.png' } });
    saveData();
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = users.find(u => u.id === id);
    if (!user || user.password !== password) return res.json({ error: 'Неверный ID или пароль' });
    if (user.isAdmin && user.allowedIp && getClientIp(req) !== user.allowedIp) {
        return res.json({ error: 'Доступ запрещён (IP)' });
    }
    if (user.isBanned || bannedUsers.includes(user.id)) return res.json({ error: 'Вы забанены' });
    res.cookie('userId', id, { maxAge: 30*24*60*60*1000, httpOnly: true });
    res.json({ success: true, user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
});

app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
    const userId = req.cookies.userId;
    const user = users.find(u => u.id === userId);
    if (!user) return res.json({ error: 'Нет пользователя' });
    if (req.file) {
        user.avatar = '/uploads/' + req.file.filename;
        saveData();
        res.json({ success: true, avatar: user.avatar });
    } else {
        res.json({ error: 'Файл не загружен' });
    }
});

app.post('/api/update-profile', (req, res) => {
    const userId = req.cookies.userId;
    const user = users.find(u => u.id === userId);
    if (!user) return res.json({ error: 'Не найден' });
    const { name, password } = req.body;
    if (name && name.trim() && name !== user.name && isNameTaken(name, userId)) {
        return res.json({ error: 'Имя занято' });
    }
    if (name && name.trim()) user.name = name.trim();
    if (password && password.trim().length >= 4) user.password = password;
    saveData();
    res.json({ success: true, user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
});

app.post('/api/search-users', (req, res) => {
    const { query } = req.body;
    const userId = req.cookies.userId;
    if (!query || query.length < 2) return res.json({ users: [] });
    const results = users.filter(u => u.id !== userId && !u.isBanned && !bannedUsers.includes(u.id))
        .filter(u => u.name.toLowerCase().includes(query.toLowerCase()) || u.id.toLowerCase().includes(query.toLowerCase()))
        .map(u => ({ id: u.id, name: u.name, isAdmin: u.isAdmin, online: u.online, avatar: u.avatar }));
    res.json({ users: results });
});

app.post('/api/add-friend', (req, res) => {
    const userId = req.cookies.userId;
    const { friendId } = req.body;
    const user = users.find(u => u.id === userId);
    if (!user) return res.json({ error: 'Ошибка' });
    if (!user.friends) user.friends = [];
    if (user.friends.includes(friendId)) return res.json({ error: 'Уже друг' });
    user.friends.push(friendId);
    saveData();
    res.json({ success: true });
});

app.get('/api/friends', (req, res) => {
    const userId = req.cookies.userId;
    const user = users.find(u => u.id === userId);
    if (!user || !user.friends) return res.json({ friends: [] });
    const friendsList = user.friends.map(fid => {
        const f = users.find(u => u.id === fid);
        return f ? { id: f.id, name: f.name, isAdmin: f.isAdmin, online: f.online, avatar: f.avatar } : null;
    }).filter(f => f);
    res.json({ friends: friendsList });
});

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
        if (target.socketId) io.to(target.socketId).emit('force_logout');
        saveData();
        broadcastUsers();
        res.json({ success: true });
    } else res.json({ error: 'Не найден' });
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
    } else res.json({ error: 'Не найден' });
});

app.get('/api/admin/users', (req, res) => {
    const userId = req.cookies.userId;
    const admin = users.find(u => u.id === userId);
    if (!admin || !admin.isAdmin) return res.json({ error: 'Нет прав' });
    const list = users.filter(u => u.id !== 'prisanok').map(u => ({
        id: u.id, name: u.name, isBanned: u.isBanned || bannedUsers.includes(u.id), online: u.online
    }));
    res.json({ users: list });
});

app.get('/api/me', (req, res) => {
    const userId = req.cookies.userId;
    if (!userId) return res.json({ user: null });
    const user = users.find(u => u.id === userId);
    if (user && (user.isBanned || bannedUsers.includes(user.id))) {
        res.clearCookie('userId');
        return res.json({ user: null });
    }
    if (user) res.json({ user: { id: user.id, name: user.name, isAdmin: user.isAdmin, avatar: user.avatar } });
    else res.json({ user: null });
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
        if (user && (user.isBanned || bannedUsers.includes(user.id))) return next(new Error('Banned'));
        socket.userId = userId;
        next();
    } else next(new Error('Unauthorized'));
});

function broadcastUsers() {
    const list = users.filter(u => !u.isBanned && !bannedUsers.includes(u.id)).map(u => ({
        id: u.id, name: u.name, isAdmin: u.isAdmin, online: u.online, avatar: u.avatar,
        displayName: u.isAdmin ? `${u.name}[АДМИН]` : u.name
    }));
    io.emit('users_update', list);
}

io.on('connection', (socket) => {
    const userId = socket.userId;
    const currentUser = users.find(u => u.id === userId);
    if (!currentUser || currentUser.isBanned || bannedUsers.includes(currentUser.id)) {
        socket.disconnect();
        return;
    }
    currentUser.online = true;
    currentUser.socketId = socket.id;
    
    socket.emit('messages_history', messages);
    broadcastUsers();
    
    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', {
            userId: currentUser.id,
            userName: currentUser.isAdmin ? `${currentUser.name}[АДМИН]` : currentUser.name,
            isTyping: data.isTyping
        });
    });
    
    socket.on('send_message', (data) => {
        if (!data.text || !data.text.trim()) return;
        const msg = {
            id: Date.now(),
            userId: currentUser.id,
            userName: currentUser.isAdmin ? `${currentUser.name}[АДМИН]` : currentUser.name,
            text: data.text.trim(),
            time: new Date().toLocaleTimeString(),
            isAdmin: currentUser.isAdmin
        };
        messages.push(msg);
        if (messages.length > 500) messages.shift();
        io.emit('new_message', msg);
        saveData();
    });
    
    socket.on('delete_message', (msgId) => {
        if (currentUser.isAdmin) {
            messages = messages.filter(m => m.id !== msgId);
            io.emit('messages_update', messages);
            saveData();
        }
    });
    
    // ЗВОНКИ
    socket.on('call_user', (data) => {
        const target = users.find(u => u.id === data.targetId);
        if (!target || !target.online || !target.socketId) {
            socket.emit('call_error', 'Пользователь не в сети');
            return;
        }
        if (activeCalls.some(c => c.to === target.id || c.from === target.id)) {
            socket.emit('call_error', 'Уже в звонке');
            return;
        }
        const call = {
            id: Date.now(),
            from: currentUser.id,
            fromName: currentUser.isAdmin ? `${currentUser.name}[АДМИН]` : currentUser.name,
            to: target.id,
            fromSocket: socket.id,
            toSocket: target.socketId
        };
        activeCalls.push(call);
        io.to(target.socketId).emit('incoming_call', {
            from: currentUser.id,
            fromName: currentUser.isAdmin ? `${currentUser.name}[АДМИН]` : currentUser.name
        });
    });
    
    socket.on('accept_call', (data) => {
        const call = activeCalls.find(c => c.from === data.fromId);
        if (call) {
            io.to(call.fromSocket).emit('call_accepted', { to: currentUser.id, toName: currentUser.isAdmin ? `${currentUser.name}[АДМИН]` : currentUser.name });
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

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`\n✅ UNBOUND сервер запущен на http://localhost:${PORT}`);
    console.log(`👑 Админ: prisanok / prisanok (только с IP 62.140.249.69)\n`);
});
