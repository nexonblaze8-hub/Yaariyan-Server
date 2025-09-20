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
let onlineUsers = new Map(); // socket.id => userId

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        console.log("MongoDB connection successful!");
    } catch (err) { console.error("Failed to connect to MongoDB", err); process.exit(1); }
}

io.on('connection', (socket) => {
    console.log(`User connected with socket ID: ${socket.id}`);

    // ব্যবহারকারী যখন নিজেকে অনলাইন হিসেবে ঘোষণা করে
    socket.on('user_online', (userId) => {
        if(userId) {
            onlineUsers.set(socket.id, userId);
            console.log(`User ${userId} is now online. Total online: ${onlineUsers.size}`);
            // সমস্ত কানেক্টেড ক্লায়েন্টকে নতুন অনলাইন তালিকা পাঠান
            io.emit('update_online_users', Array.from(onlineUsers.values()));
        }
    });

    socket.on('disconnect', () => {
        if(onlineUsers.has(socket.id)){
            console.log(`User ${onlineUsers.get(socket.id)} disconnected with socket ID: ${socket.id}`);
            onlineUsers.delete(socket.id);
            // সমস্ত কানেক্টেড ক্লায়েন্টকে নতুন অনলাইন তালিকা পাঠান
            io.emit('update_online_users', Array.from(onlineUsers.values()));
        }
    });
});

// আপনার বাকি সমস্ত কোড অপরিবর্তিত থাকবে
// ... (setupAdminAccount, authenticateToken, all API endpoints)
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

const authorizeAdminOrCoLeader = async (req, res, next) => {
    try {
        const userInDb = await usersCollection.findOne({ _id: new ObjectId(req.user.userId) });
        if (userInDb && (userInDb.role === 'admin' || userInDb.role === 'co-leader')) {
            next();
        } else { res.status(403).json({ success: false, message: "এই কাজটি করার জন্য আপনার অনুমতি নেই।" }); }
    } catch (error) { res.status(500).json({ success: false, message: "অনুমতি যাচাই করার সময় সার্ভারে সমস্যা হয়েছে।" }); }
};

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

app.get('/admin/pending-users', authenticateToken, authorizeAdminOrCoLeader, async (req, res) => {
    try {
        const pendingUsers = await usersCollection.find({ status: 'pending' }).project({ password: 0 }).toArray();
        res.status(200).json({ success: true, users: pendingUsers });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});

app.post('/admin/approve-user/:userId', authenticateToken, authorizeAdminOrCoLeader, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: { status: 'approved' } });
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: "ব্যবহারকারীকে খুঁজে পাওয়া যায়নি বা ইতিমধ্যেই অনুমোদিত।" });
        res.status(200).json({ success: true, message: "ব্যবহারকারীকে অনুমোদন করা হয়েছে।" });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});

app.delete('/admin/reject-user/:userId', authenticateToken, authorizeAdminOrCoLeader, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await usersCollection.deleteOne({ _id: new ObjectId(userId) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: "ব্যবহারকারীকে খুঁজে পাওয়া যায়নি।" });
        res.status(200).json({ success: true, message: "ব্যবহারকারীকে মুছে ফেলা হয়েছে।" });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});

async function startServer() {
    await connectDB();
    await setupAdminAccount();
    server.listen(port, () => { console.log(`Yaariyan Game Server is live on port ${port}`); });
}
// ============= HAZARI GAME MODULE =============
let gameRooms = new Map(); // roomId => { players: [], gameState: {}, createdAt: Date }

// 1. Create Game Room
app.post('/create-game-room', authenticateToken, async (req, res) => {
    try {
        const roomId = 'HZR-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const newRoom = {
            roomId,
            players: [{ userId: req.user.userId, username: req.user.username, socketId: null, ready: false }],
            gameState: {
                status: 'waiting', // waiting, playing, finished
                currentRound: 1,
                currentPlayerIndex: 0,
                scores: {},
                cards: {},
                combinations: {},
                winner: null
            },
            createdAt: new Date()
        };
        gameRooms.set(roomId, newRoom);
        res.status(200).json({ success: true, roomId, message: "গেম রুম তৈরি হয়েছে!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "রুম তৈরি করতে সমস্যা হয়েছে।" });
    }
});

// 2. Join Game Room
app.post('/join-game-room/:roomId', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.params;
        const room = gameRooms.get(roomId);
        if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
        if (room.players.length >= 4) return res.status(400).json({ success: false, message: "রুম পূর্ণ।" });
        if (room.players.some(p => p.userId === req.user.userId)) return res.status(400).json({ success: false, message: "আপনি ইতিমধ্যে এই রুমে আছেন।" });
        room.players.push({ userId: req.user.userId, username: req.user.username, socketId: null, ready: false });
        res.status(200).json({ success: true, message: "রুমে যোগ দেওয়া হয়েছে!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "রুমে যোগ দিতে সমস্যা হয়েছে।" });
    }
});

// 3. Get Game State
app.get('/get-game-state/:roomId', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.params;
        const room = gameRooms.get(roomId);
        if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
        res.status(200).json({ success: true, gameState: room });
    } catch (error) {
        res.status(500).json({ success: false, message: "গেম স্টেট লোড করতে সমস্যা হয়েছে।" });
    }
});
// 4. Start Game & Deal Cards
app.post('/start-game/:roomId', authenticateToken, async (req, res) => {
    try {
        const { roomId } = req.params;
        const room = gameRooms.get(roomId);
        if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
        if (room.players.length < 4) return res.status(400).json({ success: false, message: "খেলা শুরু করতে কমপক্ষে ৪ জন প্রয়োজন।" });
        if (room.gameState.status !== 'waiting') return res.status(400).json({ success: false, message: "খেলা ইতিমধ্যে শুরু হয়েছে।" });

        // তাস তৈরি করুন
        const suits = ['♠️', '♥️', '♦️', '♣️'];
        const values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
        let deck = [];
        for (let suit of suits) {
            for (let value of values) {
                deck.push({ suit, value, point: ['A', 'K', 'Q', 'J', '10'].includes(value) ? 10 : 5 });
            }
        }

        // তাস মিশিয়ে নিন
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }

        // প্রত্যেক খেলোয়াড়কে ১৩টি করে তাস দিন
        room.players.forEach((player, index) => {
            const start = index * 13;
            room.gameState.cards[player.userId] = deck.slice(start, start + 13);
            room.gameState.scores[player.userId] = 0;
            room.gameState.combinations[player.userId] = [];
        });

        room.gameState.status = 'playing';
        room.gameState.currentPlayerIndex = 0;

        res.status(200).json({ success: true, message: "খেলা শুরু হয়েছে!", gameState: room.gameState });
    } catch (error) {
        res.status(500).json({ success: false, message: "খেলা শুরু করতে সমস্যা হয়েছে।" });
    }
});

// 5. Submit Combination (চাল জমা দেওয়া)
app.post('/submit-combination', authenticateToken, async (req, res) => {
    try {
        const { roomId, combination } = req.body; // combination = { type: 'troy', cards: [...] }
        const room = gameRooms.get(roomId);
        if (!room) return res.status(404).json({ success: false, message: "রুম খুঁজে পাওয়া যায়নি।" });
        if (room.gameState.status !== 'playing') return res.status(400).json({ success: false, message: "খেলা চলছে না।" });

        const currentPlayer = room.players[room.gameState.currentPlayerIndex];
        if (currentPlayer.userId !== req.user.userId) return res.status(400).json({ success: false, message: "এখন আপনার চাল নয়।" });

        // সহজ ভাবে — কম্বিনেশন সেভ করুন
        room.gameState.combinations[req.user.userId] = combination;

        // পরবর্তী খেলোয়াড়ের কাছে যান
        room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % 4;

        // যদি সব ৪ জন চাল দিয়ে থাকে — রাউন্ড শেষ
        if (Object.keys(room.gameState.combinations).length === 4) {
            // সহজ ভাবে — সবার পয়েন্ট বাড়ান (পরে রিয়েল লজিক যোগ করবেন)
            room.players.forEach(p => {
                room.gameState.scores[p.userId] += 50; // ডামি পয়েন্ট
            });

            // গেম শেষ হয়েছে কিনা চেক করুন
            for (let p of room.players) {
                if (room.gameState.scores[p.userId] >= 1000) {
                    room.gameState.status = 'finished';
                    room.gameState.winner = p.username;
                    break;
                }
            }

            // কম্বিনেশন ক্লিয়ার করুন — পরের রাউন্ডের জন্য
            room.gameState.combinations = {};
        }

        res.status(200).json({ success: true, message: "চাল জমা দেওয়া হয়েছে!", gameState: room.gameState });
    } catch (error) {
        res.status(500).json({ success: false, message: "চাল জমা দিতে সমস্যা হয়েছে।" });
    }
});
startServer();
