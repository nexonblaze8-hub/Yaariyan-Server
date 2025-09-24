const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { 
        origin: "*", 
        methods: ["GET", "POST"] 
    },
    transports: ['websocket', 'polling']
});

const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-yaariyan';

if (!uri) { console.error("MONGO_URI environment variable not set."); process.exit(1); }
const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, usersCollection;
const onlineUsers = new Map();
const userSockets = new Map(); 

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        console.log("MongoDB connection successful!");
    } catch (err) { console.error("Failed to connect to MongoDB", err); process.exit(1); }
}

const authenticateSocket = (socket, next) => {
    const token = socket.handshake.auth.token;
    if (token == null) return next(new Error('Authentication error: Token not provided'));
    jwt.verify(token, JWT_SECRET, (err, userPayload) => {
        if (err) return next(new Error('Authentication error: Token is invalid'));
        socket.user = userPayload;
        next();
    });
};

io.use(authenticateSocket);

// Game state management
const gameRooms = new Map();

const HazariLogic = {
    cardValues: { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 },
    cardPoints: { 'A': 10, 'K': 10, 'Q': 10, 'J': 10, '10': 10, '9': 5, '8': 5, '7': 5, '6': 5, '5': 5, '4': 5, '3': 5, '2': 5 },

    dealCards: () => {
        const suits = ['♠️', '♥️', '♦️', '♣️'];
        const values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        let deck = [];
        for (let suit of suits) {
            for (let value of values) {
                deck.push({ suit, value });
            }
        }
        deck.sort(() => Math.random() - 0.5);
        return [deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39, 52)];
    },

    calculateCombination: (cards, type) => {
        const points = {
            'troy': 20,
            'color-run': 30,
            'run': 15,
            'color': 10
        };
        return points[type] || 0;
    }
};

const broadcastGameState = (roomId) => {
    const room = gameRooms.get(roomId);
    if (room) {
        io.to(roomId).emit('server_game_state_update', room);
    }
};

io.on('connection', (socket) => {
    const userId = socket.user.userId;
    const username = socket.user.username;
    console.log(`User ${userId} (${username}) connected with socket ID: ${socket.id}`);
    
    onlineUsers.set(socket.id, { userId, username });
    userSockets.set(userId, socket.id);
    
    io.emit('update_online_users', Array.from(userSockets.keys()));

    // Game room socket events
    socket.on('client_create_room', () => {
        try {
            const roomId = 'HZR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
            const newRoom = {
                roomId,
                players: [{ userId, username, ready: false }],
                gameState: {
                    status: 'waiting',
                    scores: { [userId]: 0 },
                    cards: {},
                    currentPlayerIndex: 0,
                    dealerIndex: 0,
                    table: [],
                    winner: null
                },
                createdAt: new Date()
            };
            
            gameRooms.set(roomId, newRoom);
            socket.join(roomId);
            
            console.log(`Room ${roomId} created by user ${username}`);
            socket.emit('server_game_state_update', newRoom);
        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('game_error', { message: 'রুম তৈরি করতে সমস্যা হয়েছে' });
        }
    });

    socket.on('client_join_room', (data) => {
        try {
            const { roomId } = data;
            const room = gameRooms.get(roomId);
            
            if (!room) {
                socket.emit('game_error', { message: 'রুম খুঁজে পাওয়া যায়নি' });
                return;
            }
            
            if (room.players.length >= 4) {
                socket.emit('game_error', { message: 'রুম পূর্ণ' });
                return;
            }
            
            if (room.players.some(p => p.userId === userId)) {
                socket.emit('game_error', { message: 'আপনি ইতিমধ্যে এই রুমে আছেন' });
                return;
            }
            
            room.players.push({ userId, username, ready: false });
            room.gameState.scores[userId] = 0;
            
            socket.join(roomId);
            console.log(`User ${username} joined room ${roomId}`);
            
            broadcastGameState(roomId);
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('game_error', { message: 'রুমে যোগ দিতে সমস্যা হয়েছে' });
        }
    });

    socket.on('client_start_game', (data) => {
        try {
            const { roomId } = data;
            const room = gameRooms.get(roomId);
            
            if (!room) {
                socket.emit('game_error', { message: 'রুম খুঁজে পাওয়া যায়নি' });
                return;
            }
            
            if (room.players.length !== 4) {
                socket.emit('game_error', { message: 'খেলা শুরু করতে ৪ জন খেলোয়াড় প্রয়োজন' });
                return;
            }
            
            if (room.players[0].userId !== userId) {
                socket.emit('game_error', { message: 'শুধুমাত্র রুম তৈরি কর্তাই খেলা শুরু করতে পারেন' });
                return;
            }
            
            room.gameState.status = 'playing';
            const dealtHands = HazariLogic.dealCards();
            
            room.players.forEach((player, index) => {
                room.gameState.cards[player.userId] = dealtHands[index];
            });
            
            room.gameState.currentPlayerIndex = (room.gameState.dealerIndex + 1) % 4;
            
            console.log(`Game started in room ${roomId}`);
            broadcastGameState(roomId);
            
        } catch (error) {
            console.error('Error starting game:', error);
            socket.emit('game_error', { message: 'খেলা শুরু করতে সমস্যা হয়েছে' });
        }
    });

    socket.on('client_submit_combination', (data) => {
        try {
            const { roomId, combination } = data;
            const room = gameRooms.get(roomId);
            
            if (!room || room.gameState.status !== 'playing') {
                socket.emit('game_error', { message: 'খেলা চলমান নেই' });
                return;
            }
            
            const currentPlayer = room.players[room.gameState.currentPlayerIndex];
            if (currentPlayer.userId !== userId) {
                socket.emit('game_error', { message: 'এখন আপনার পালা নয়' });
                return;
            }
            
            const points = HazariLogic.calculateCombination(combination.cards, combination.type);
            room.gameState.scores[userId] += points;
            
            room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % 4;
            
            console.log(`User ${username} submitted combination: ${combination.type} for ${points} points`);
            broadcastGameState(roomId);
            
        } catch (error) {
            console.error('Error submitting combination:', error);
            socket.emit('game_error', { message: 'চাল জমা দিতে সমস্যা হয়েছে' });
        }
    });

    socket.on('client_leave_room', (data) => {
        try {
            const { roomId } = data;
            const room = gameRooms.get(roomId);
            
            if (room) {
                room.players = room.players.filter(p => p.userId !== userId);
                
                if (room.players.length === 0) {
                    gameRooms.delete(roomId);
                    console.log(`Room ${roomId} deleted (no players left)`);
                } else {
                    delete room.gameState.scores[userId];
                    delete room.gameState.cards[userId];
                    
                    if (room.gameState.status === 'playing') {
                        room.gameState.status = 'waiting';
                    }
                    
                    console.log(`User ${username} left room ${roomId}`);
                    broadcastGameState(roomId);
                }
                
                socket.leave(roomId);
            }
        } catch (error) {
            console.error('Error leaving room:', error);
        }
    });

    socket.on('disconnect', () => {
        if(onlineUsers.has(socket.id)){
            const disconnectedUser = onlineUsers.get(socket.id);
            console.log(`User ${disconnectedUser.username} disconnected with socket ID: ${socket.id}`);
            
            onlineUsers.delete(socket.id);
            userSockets.delete(disconnectedUser.userId);
            
            io.emit('update_online_users', Array.from(userSockets.keys()));
        }
    });
});

async function setupAdminAccount() {
    const ADMIN_USERNAME = "Mtr@rkS";
    const ADMIN_PASSWORD = "264148";
    try {
        const adminUser = await usersCollection.findOne({ username: ADMIN_USERNAME.toLowerCase() });
        if (!adminUser) {
            console.log("Admin account not found. Creating a new one...");
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);
            const newAdmin = { 
                fullName: "MTR (Admin)", 
                email: "admin@yaariyan.local", 
                username: ADMIN_USERNAME.toLowerCase(), 
                password: hashedPassword, 
                role: 'admin', 
                status: 'approved', 
                profilePictureUrl: "", 
                coverPhotoUrl: "", 
                bio: "Yaariyan App-এর অ্যাডমিনিস্ট্রেটর।", 
                createdAt: new Date() 
            };
            await usersCollection.insertOne(newAdmin);
            console.log("Admin account created successfully!");
        } else { 
            console.log("Admin account verified."); 
        }
    } catch (error) { 
        console.error("Error during admin account setup:", error); 
    }
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ success: false, message: 'Token not provided' });
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Token is invalid' });
        req.user = user;
        next();
    });
};

app.get('/', (req, res) => res.json({ 
    success: true, 
    message: 'Welcome to Yaariyan Game Server!',
    activeRooms: gameRooms.size,
    onlineUsers: onlineUsers.size
}));

app.post('/register', async (req, res) => {
    try {
        const { fullName, username, email, password } = req.body;
        if (!fullName || !username || !email || !password) {
            return res.status(400).json({ success: false, message: 'সমস্ত তথ্য পূরণ করুন' });
        }

        const existingUser = await usersCollection.findOne({ 
            $or: [{ email: email.toLowerCase() }, { username: username.toLowerCase() }] 
        });
        
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'ইউজারনেম বা ইমেল ইতিমধ্যে ব্যবহৃত হচ্ছে' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            fullName,
            username: username.toLowerCase(),
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'user',
            status: 'approved',
            profilePictureUrl: "",
            coverPhotoUrl: "",
            bio: "",
            createdAt: new Date(),
            points: 0
        };

        await usersCollection.insertOne(newUser);
        res.status(201).json({ success: true, message: 'রেজিস্ট্রেশন সফল!' });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'রেজিস্ট্রেশনে সমস্যা হয়েছে' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: 'ইমেল/ইউজারনেম এবং পাসওয়ার্ড দিন' });
        }

        const user = await usersCollection.findOne({
            $or: [
                { email: identifier.toLowerCase() },
                { username: identifier.toLowerCase() }
            ]
        });

        if (!user) {
            return res.status(400).json({ success: false, message: 'ইউজারনেম বা পাসওয়ার্ড ভুল' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ success: false, message: 'ইউজারনেম বা পাসওয়ার্ড ভুল' });
        }

        const tokenPayload = {
            userId: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            message: 'লগইন সফল!',
            token,
            profile: {
                _id: user._id,
                fullName: user.fullName,
                username: user.username,
                email: user.email,
                profilePictureUrl: user.profilePictureUrl,
                coverPhotoUrl: user.coverPhotoUrl,
                bio: user.bio,
                points: user.points || 0
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'লগইনে সমস্যা হয়েছে' });
    }
});

app.get('/get-profile', authenticateToken, async (req, res) => {
    try {
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
        if (!user) {
            return res.status(404).json({ success: false, message: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি' });
        }

        res.json({
            success: true,
            profile: {
                _id: user._id,
                fullName: user.fullName,
                username: user.username,
                email: user.email,
                profilePictureUrl: user.profilePictureUrl,
                coverPhotoUrl: user.coverPhotoUrl,
                bio: user.bio,
                points: user.points || 0
            }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ success: false, message: 'প্রোফাইল লোড করতে সমস্যা হয়েছে' });
    }
});

app.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { fullName, bio, profilePictureUrl, coverPhotoUrl } = req.body;
        const updateData = {};
        
        if (fullName) updateData.fullName = fullName;
        if (bio !== undefined) updateData.bio = bio;
        if (profilePictureUrl) updateData.profilePictureUrl = profilePictureUrl;
        if (coverPhotoUrl) updateData.coverPhotoUrl = coverPhotoUrl;

        await usersCollection.updateOne(
            { _id: new ObjectId(req.user.userId) },
            { $set: updateData }
        );

        res.json({ success: true, message: 'প্রোফাইল আপডেট করা হয়েছে!' });

    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ success: false, message: 'প্রোফাইল আপডেট করতে সমস্যা হয়েছে' });
    }
});

async function startServer() {
    await connectDB();
    await setupAdminAccount();
    server.listen(port, () => { 
        console.log(`Yaariyan Game Server is live on port ${port}`);
        console.log(`Socket.IO game events are ready for Hazari game`);
    });
}

startServer();
