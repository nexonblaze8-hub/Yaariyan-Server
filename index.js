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
const onlineUsers = new Map(); // socket.id => { userId, socket }
const userSockets = new Map(); // userId => socket.id

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        console.log("MongoDB connection successful!");
    } catch (err) { console.error("Failed to connect to MongoDB", err); process.exit(1); }
}

const authenticateSocket = async (socket, next) => {
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
    
    onlineUsers.set(socket.id, { userId, socket });
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

// ... (Your other API endpoints like /register, /login, /get-profile etc. remain unchanged)
app.get('/', (req, res) => res.json({ success: true, message: 'Welcome to Yaariyan Game Server!' }));
app.post('/register', async (req, res) => {
    try {
        const { fullName, email, password, username } = req.body;
        if (!fullName || !email || !password || !username) return res.status(400).json({ success: false, message: "সম্পূর্ণ তথ্য দিন।" });
        const existingUser = await usersCollection.findOne({ $or: [{email: email.toLowerCase()}, {username: username.toLowerCase()}] });
        if (existingUser) return res.status(400).json({ success: false, message: "এই ইমেল বা ইউজারনেমটি ব্যবহৃত হয়েছে।" });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = { fullName, email: email.toLowerCase(), username: username.toLowerCase(), password: hashedPassword, role: 'user', status: 'pending', profilePictureUrl: "", coverPhotoUrl: "", bio: "", createdAt: new Date() };
        await usersCollection.insertOne(newUser);
        res.status(201).json({ success: true, message: "রেজিস্ট্রেশন সফল! অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।" });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});
app.post('/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) return res.status(400).json({ success: false, message: "অনুগ্রহ করে সঠিক তথ্য দিন।" });
        const user = await usersCollection.findOne({ $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }] });
        if (!user) return res.status(404).json({ success: false, message: "ব্যবহারকারীকে খুঁজে পাওয়া যায়নি।" });
        if (user.status !== 'approved') return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি এখনও অনুমোদিত হয়নি।" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "ভুল পাসওয়ার্ড।" });
        const userPayload = { userId: user._id.toString(), email: user.email, role: user.role, fullName: user.fullName, username: user.username };
        const accessToken = jwt.sign(userPayload, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ success: true, message: "লগইন সফল!", token: accessToken });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});
app.get('/get-profile', authenticateToken, async (req, res) => {
    try {
        const userProfile = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) }, { projection: { password: 0 } });
        if (!userProfile) return res.status(404).json({ success: false, message: "প্রোফাইল খুঁজে পাওয়া যায়নি।" });
        res.status(200).json({ success: true, profile: userProfile });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});
app.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { bio, profilePictureUrl, coverPhotoUrl } = req.body;
        const userId = req.user.userId;
        const updateData = {};
        if (bio !== undefined) updateData.bio = bio;
        if (profilePictureUrl) updateData.profilePictureUrl = profilePictureUrl;
        if (coverPhotoUrl) updateData.coverPhotoUrl = coverPhotoUrl;
        if (Object.keys(updateData).length === 0) return res.status(400).json({ success: false, message: "কোনো তথ্য পরিবর্তন করা হয়নি।" });
        await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: updateData });
        res.status(200).json({ success: true, message: "প্রোফাইল সফলভাবে আপডেট করা হয়েছে।" });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" }); }
});

// ============= HAZARI GAME MODULE (UPGRADED) =============
const gameRooms = new Map();

// Helper functions for game logic (to be created)
const HazariLogic = require('./hazari-logic'); // Assuming logic is in a separate file for clarity

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

app.post('/create-game-room', authenticateToken, (req, res) => {
    try {
        const roomId = 'HZR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const newRoom = {
            roomId,
            players: [{ userId: req.user.userId, username: req.user.username }],
            gameState: {
                status: 'waiting', // waiting, dealing, playing, round_end, finished
                dealerIndex: 0,
                currentPlayerIndex: -1,
                scores: { [req.user.userId]: 0 },
                hands: {}, // player's 13 cards
                playerSets: {}, // player's 3-3-3-4 sets
                table: [], // cards played in current turn
                roundWinner: null,
                gameWinner: null
            },
            createdAt: new Date()
        };
        gameRooms.set(roomId, newRoom);
        res.status(200).json({ success: true, roomId, message: "গেম রুম তৈরি হয়েছে!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "রুম তৈরি করতে সমস্যা হয়েছে।" });
    }
});

app.post('/join-game-room/:roomId', authenticateToken, (req, res) => {
    try {
        const { roomId } = req.params;
        const room = gameRooms.get(roomId);
        if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
        if (room.players.length >= 4) return res.status(400).json({ success: false, message: "রুম পূর্ণ।" });
        if (room.players.some(p => p.userId === req.user.userId)) {
             broadcastGameState(roomId); // broadcast to update UI for existing user
             return res.status(200).json({ success: true, message: "আপনি ইতিমধ্যে এই রুমে আছেন।" });
        }
        room.players.push({ userId: req.user.userId, username: req.user.username });
        room.gameState.scores[req.user.userId] = 0;
        broadcastGameState(roomId);
        res.status(200).json({ success: true, message: "রুমে যোগ দেওয়া হয়েছে!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "রুমে যোগ দিতে সমস্যা হয়েছে।" });
    }
});

app.get('/get-game-state/:roomId', authenticateToken, (req, res) => {
    const { roomId } = req.params;
    const room = gameRooms.get(roomId);
    if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
    res.status(200).json({ success: true, gameState: room });
});

app.post('/start-game/:roomId', authenticateToken, (req, res) => {
    const { roomId } = req.params;
    const room = gameRooms.get(roomId);
    if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
    if (room.players.length < 4) return res.status(400).json({ success: false, message: "খেলা শুরু করতে ৪ জন প্রয়োজন।" });
    
    // Start the game logic
    room.gameState.status = 'dealing';
    const dealtCards = HazariLogic.dealCards(); // This function should return hands for 4 players
    
    let hasRun = false;
    room.players.forEach((player, index) => {
        room.gameState.hands[player.userId] = dealtCards[index];
        // Server checks for run condition
        if(HazariLogic.checkForRun(dealtCards[index])) {
            hasRun = true;
        }
    });

    // As per rule, if any one player doesn't have a run, redeal. Let's simplify: check if EVERYONE has a run.
    // NOTE: This check is simplified. Your rule said "if a player doesn't have a run". This can be complex to enforce fairly.
    // A better rule might be "If ANY player has NO run, redeal." For now, we assume dealing continues.

    // Divide cards into sets
    room.players.forEach(player => {
        room.gameState.playerSets[player.userId] = HazariLogic.sortAndGroupCards(room.gameState.hands[player.userId]);
    });

    room.gameState.status = 'playing';
    // Dealer's right starts. If dealer is index 0, player at index 1 starts.
    room.gameState.currentPlayerIndex = (room.gameState.dealerIndex + 1) % 4;

    broadcastGameState(roomId);
    res.status(200).json({ success: true, message: "খেলা শুরু হয়েছে!" });
});

app.post('/play-move/:roomId', authenticateToken, (req, res) => {
    const { roomId } = req.params;
    const { move } = req.body; // move should be an array of card objects
    const room = gameRooms.get(roomId);

    if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
    const currentPlayer = room.players[room.gameState.currentPlayerIndex];
    if (currentPlayer.userId !== req.user.userId) return res.status(403).json({ success: false, message: "এখন আপনার চাল নয়।" });

    // Validate the move
    const isValid = HazariLogic.validateMove(move, room.gameState.playerSets[req.user.userId], room.gameState.table);
    if (!isValid) return res.status(400).json({ success: false, message: "অবৈধ চাল।" });

    // Process the move
    room.gameState.table.push({ userId: req.user.userId, cards: move });
    // Remove cards from player's hand/sets
    room.gameState.playerSets[req.user.userId] = HazariLogic.removeSetFromPlayer(move, room.gameState.playerSets[req.user.userId]);
    
    // Check if turn ends
    if (room.gameState.table.length === 4) {
        // End of turn, determine winner
        const turnWinner = HazariLogic.getTurnWinner(room.gameState.table);
        const winnerPlayer = room.players.find(p => p.userId === turnWinner.userId);
        
        // Update winner's score (logic to calculate points of cards on table)
        const pointsWon = HazariLogic.calculatePoints(room.gameState.table);
        room.gameState.scores[turnWinner.userId] += pointsWon;

        // Set next player to be the winner of this turn
        room.gameState.currentPlayerIndex = room.players.findIndex(p => p.userId === turnWinner.userId);
        room.gameState.table = []; // Clear table for next turn

        // Check if round ends (all 13 cards played)
        if (Object.values(room.gameState.playerSets).every(sets => sets.length === 0)) {
            room.gameState.status = 'round_end';
            // Check for game winner
            const gameWinner = Object.entries(room.gameState.scores).find(([userId, score]) => score >= 1000);
            if (gameWinner) {
                room.gameState.status = 'finished';
                room.gameState.gameWinner = room.players.find(p=>p.userId === gameWinner[0]).username;
            } else {
                // Prepare for next round
                room.gameState.dealerIndex = (room.gameState.dealerIndex + 1) % 4;
            }
        }
    } else {
        // Go to next player
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % 4;
    }

    broadcastGameState(roomId);
    res.status(200).json({ success: true, message: "চাল দেওয়া হয়েছে।" });
});

// We need to create hazari-logic.js to handle the game rules
// This is a placeholder for where the complex game logic would reside.
HazariLogic = {
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
    checkForRun: (hand) => { /* Logic to check for a run */ return true; },
    sortAndGroupCards: (hand) => { /* Logic to sort and group into 4 sets */ return [hand.slice(0,3), hand.slice(3,6), hand.slice(6,9), hand.slice(9,13)];},
    validateMove: (move, playerSets, table) => { /* Logic to validate move */ return true; },
    removeSetFromPlayer: (move, playerSets) => { /* Logic to remove cards */ return playerSets.slice(1); },
    getTurnWinner: (table) => { /* Logic to find winner of the 4 players' moves */ return table[0]; },
    calculatePoints: (table) => { /* Logic to calculate points from cards */ return 90; }
};


async function startServer() {
    await connectDB();
    await setupAdminAccount();
    server.listen(port, () => { console.log(`Yaariyan Game Server is live on port ${port}`); });
}

startServer();
