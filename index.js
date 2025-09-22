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

io.on('connection', (socket) => {
    const userId = socket.user.userId;
    console.log(`User ${userId} connected with socket ID: ${socket.id}`);
    
    onlineUsers.set(socket.id, { userId });
    userSockets.set(userId, socket.id);
    
    io.emit('update_online_users', Array.from(userSockets.keys()));

    socket.on('disconnect', () => {
        if(onlineUsers.has(socket.id)){
            const disconnectedUserId = onlineUsers.get(socket.id).userId;
            console.log(`User ${disconnectedUserId} disconnected with socket ID: ${socket.id}`);
            onlineUsers.delete(socket.id);
            userSockets.delete(disconnectedUserId);
            io.emit('update_online_users', Array.from(userSockets.keys()));
        }
    });
});

async function setupAdminAccount() {
    // ... (This function remains unchanged)
    const ADMIN_USERNAME = "Mtr@rkS";
    const ADMIN_PASSWORD = "264148";
    try {
        const adminUser = await usersCollection.findOne({ username: ADMIN_USERNAME.toLowerCase() });
        if (!adminUser) {
            console.log("Admin account not found. Creating a new one...");
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);
            const newAdmin = { fullName: "MTR (Admin)", email: "admin@yaariyan.local", username: ADMIN_USERNAME.toLowerCase(), password: hashedPassword, role: 'admin', status: 'approved', profilePictureUrl: "", coverPhotoUrl: "", bio: "Yaariyan App-এর অ্যাডমিনিস্ট্রেটর।", createdAt: new Date() };
            await usersCollection.insertOne(newAdmin);
            console.log("Admin account created successfully!");
        } else { console.log("Admin account verified."); }
    } catch (error) { console.error("Error during admin account setup:", error); }
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

// --- Basic API endpoints remain unchanged ---
app.get('/', (req, res) => res.json({ success: true, message: 'Welcome to Yaariyan Game Server!' }));
app.post('/register', async (req, res) => { /* ... Unchanged ... */ });
app.post('/login', async (req, res) => { /* ... Unchanged ... */ });
app.get('/get-profile', authenticateToken, async (req, res) => { /* ... Unchanged ... */ });
app.post('/update-profile', authenticateToken, async (req, res) => { /* ... Unchanged ... */ });


// ==========================================================
// ============= HAZARI GAME LOGIC (INTEGRATED) =============
// ==========================================================

const gameRooms = new Map();

const broadcastGameState = (roomId) => {
    const room = gameRooms.get(roomId);
    if (room) {
        room.players.forEach(player => {
            const socketId = userSockets.get(player.userId);
            if (socketId) {
                io.to(socketId).emit('game_state_update', room);
            }
        });
    }
};

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
        deck.sort(() => Math.random() - 0.5); // Shuffle deck
        return [deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39, 52)];
    },
    
    // ... Other logic functions will be here
};

app.post('/create-game-room', authenticateToken, (req, res) => {
    const roomId = 'HZR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const newRoom = {
        roomId,
        players: [{ userId: req.user.userId, username: req.user.username }],
        gameState: {
            status: 'waiting',
            scores: { [req.user.userId]: 0 },
            hands: {},
            currentPlayerIndex: 0,
            dealerIndex: 0,
            table: [],
        },
    };
    gameRooms.set(roomId, newRoom);
    res.status(200).json({ success: true, roomId });
});

app.post('/join-game-room/:roomId', authenticateToken, (req, res) => {
    const { roomId } = req.params;
    const room = gameRooms.get(roomId);
    if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
    if (room.players.length >= 4) return res.status(400).json({ success: false, message: "রুম পূর্ণ।" });
    if (!room.players.some(p => p.userId === req.user.userId)) {
        room.players.push({ userId: req.user.userId, username: req.user.username });
        room.gameState.scores[req.user.userId] = 0;
    }
    broadcastGameState(roomId);
    res.status(200).json({ success: true, message: "রুমে যোগ দেওয়া হয়েছে!" });
});

app.get('/get-game-state/:roomId', authenticateToken, (req, res) => {
    const { roomId } = req.params;
    const room = gameRooms.get(roomId);
    if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
    res.status(200).json({ success: true, gameState: room });
});

app.post('/start-game/:roomId', authenticateToken, (req, res) => {
    const { roomId } = req.params;
    const room = gameRooms.get(roomId);
    if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
    if (room.players.length !== 4) return res.status(400).json({ success: false, message: "খেলা শুরু করতে ৪ জন প্রয়োজন।" });

    room.gameState.status = 'playing';
    const dealtHands = HazariLogic.dealCards();
    room.players.forEach((player, index) => {
        room.gameState.hands[player.userId] = dealtHands[index];
    });

    room.gameState.currentPlayerIndex = (room.gameState.dealerIndex + 1) % 4;
    broadcastGameState(roomId);
    res.status(200).json({ success: true, message: "খেলা শুরু হয়েছে!" });
});


// Add other game endpoints here if needed

async function startServer() {
    await connectDB();
    await setupAdminAccount();
    server.listen(port, () => { console.log(`Yaariyan Game Server is live on port ${port}`); });
}

startServer();
