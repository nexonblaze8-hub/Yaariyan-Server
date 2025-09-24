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

// === NEW CODE START ===
// Universal card dealing function
const dealCards = (numPlayers = 4, cardsPerPlayer = 13) => {
    const suits = ['♠️', '♥️', '♦️', '♣️'];
    const values = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    let deck = [];
    for (let suit of suits) {
        for (let value of values) {
            deck.push({ suit, value });
        }
    }
    deck.sort(() => Math.random() - 0.5);
    
    const hands = [];
    for (let i = 0; i < numPlayers; i++) {
        hands.push(deck.slice(i * cardsPerPlayer, (i + 1) * cardsPerPlayer));
    }
    return hands;
};
// === NEW CODE END ===

const HazariLogic = {
    cardValues: { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 },
    cardPoints: { 'A': 10, 'K': 10, 'Q': 10, 'J': 10, '10': 10, '9': 5, '8': 5, '7': 5, '6': 5, '5': 5, '4': 5, '3': 5, '2': 5 },

    // We now use the universal dealCards function
    dealCards: () => dealCards(4, 13),

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

// === NEW CODE START ===
const CallBreakLogic = {
    cardValues: { 'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2 },

    determineHandWinner: (table, leadingSuit, trumpSuit = '♠️') => {
        let winner = table[0];
        let highestCard = table[0].card;
        
        for (let i = 1; i < table.length; i++) {
            const currentEntry = table[i];
            const currentCard = currentEntry.card;

            if (highestCard.suit === trumpSuit) {
                if (currentCard.suit === trumpSuit && CallBreakLogic.cardValues[currentCard.value] > CallBreakLogic.cardValues[highestCard.value]) {
                    winner = currentEntry;
                    highestCard = currentCard;
                }
            } else {
                if (currentCard.suit === trumpSuit) {
                    winner = currentEntry;
                    highestCard = currentCard;
                } else if (currentCard.suit === highestCard.suit && CallBreakLogic.cardValues[currentCard.value] > CallBreakLogic.cardValues[highestCard.value]) {
                    winner = currentEntry;
                    highestCard = currentCard;
                }
            }
        }
        return winner;
    },

    calculateRoundScores: (bids, handsWon) => {
        const roundScores = {};
        for (const userId in bids) {
            const bid = bids[userId];
            const won = handsWon[userId];
            if (won >= bid) {
                roundScores[userId] = bid;
            } else {
                roundScores[userId] = -bid;
            }
        }
        return roundScores;
    }
};
// === NEW CODE END ===


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

    // === MODIFIED CODE START ===
    socket.on('client_create_room', (data) => {
        try {
            const { gameType } = data; // 'hazari' or 'callbreak'
            if (!['hazari', 'callbreak'].includes(gameType)) {
                return socket.emit('game_error', { message: 'অবৈধ খেলার ধরন' });
            }

            const roomId = `${gameType.slice(0, 3).toUpperCase()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            
            let initialGameState;
            if (gameType === 'hazari') {
                initialGameState = {
                    status: 'waiting',
                    scores: { [userId]: 0 },
                    cards: {},
                    currentPlayerIndex: 0,
                    dealerIndex: 0,
                    table: [],
                    winner: null
                };
            } else if (gameType === 'callbreak') {
                initialGameState = {
                    status: 'waiting', // Will become 'bidding' when game starts
                    totalRounds: 5,
                    currentRound: 0,
                    dealerIndex: 0,
                    bids: {},
                    handsWon: {},
                    table: [],
                    scores: {}
                };
            }

            const newRoom = {
                roomId,
                gameType,
                players: [{ userId, username, ready: false }],
                hostId: userId,
                gameState: initialGameState,
                createdAt: new Date()
            };
            
            gameRooms.set(roomId, newRoom);
            socket.join(roomId);
            
            console.log(`Room ${roomId} (${gameType}) created by user ${username}`);
            socket.emit('server_room_created', newRoom); // Send the full room details back to creator
            broadcastGameState(roomId);

        } catch (error) {
            console.error('Error creating room:', error);
            socket.emit('game_error', { message: 'রুম তৈরি করতে সমস্যা হয়েছে' });
        }
    });
    // === MODIFIED CODE END ===

    socket.on('client_join_room', (data) => {
        try {
            const { roomId } = data;
            const room = gameRooms.get(roomId);
            
            if (!room) return socket.emit('game_error', { message: 'রুম খুঁজে পাওয়া যায়নি' });
            if (room.players.length >= 4) return socket.emit('game_error', { message: 'রুম পূর্ণ' });
            if (room.players.some(p => p.userId === userId)) return socket.emit('game_error', { message: 'আপনি ইতিমধ্যে এই রুমে আছেন' });
            
            room.players.push({ userId, username, ready: false });
            if (room.gameType === 'hazari') room.gameState.scores[userId] = 0;
            
            socket.join(roomId);
            console.log(`User ${username} joined room ${roomId}`);
            broadcastGameState(roomId);
        } catch (error) {
            console.error('Error joining room:', error);
            socket.emit('game_error', { message: 'রুমে যোগ দিতে সমস্যা হয়েছে' });
        }
    });

    // === MODIFIED CODE START ===
    socket.on('client_start_game', (data) => {
        try {
            const { roomId } = data;
            const room = gameRooms.get(roomId);
            
            if (!room) return socket.emit('game_error', { message: 'রুম খুঁজে পাওয়া যায়নি' });
            if (room.players.length !== 4) return socket.emit('game_error', { message: 'খেলা শুরু করতে ৪ জন খেলোয়াড় প্রয়োজন' });
            if (room.hostId !== userId) return socket.emit('game_error', { message: 'শুধুমাত্র রুম হোস্টই খেলা শুরু করতে পারেন' });

            const dealtHands = dealCards(4, 13);
            room.players.forEach((player, index) => {
                room.gameState.cards[player.userId] = dealtHands[index];
            });

            if (room.gameType === 'hazari') {
                room.gameState.status = 'playing';
                room.gameState.dealerIndex = (room.gameState.dealerIndex + 1) % 4;
                room.gameState.currentPlayerIndex = (room.gameState.dealerIndex + 1) % 4;
            } else if (room.gameType === 'callbreak') {
                room.gameState.status = 'bidding';
                room.gameState.currentRound += 1;
                room.gameState.dealerIndex = (room.gameState.dealerIndex + 1) % 4;
                room.gameState.currentPlayerIndex = (room.gameState.dealerIndex + 1) % 4; // Bidding starts after dealer
                // Reset bids and hands won for the new round
                room.players.forEach(p => {
                    room.gameState.bids[p.userId] = null; // null means not bid yet
                    room.gameState.handsWon[p.userId] = 0;
                });
            }
            
            console.log(`Game started in room ${roomId}`);
            broadcastGameState(roomId);
        } catch (error) {
            console.error('Error starting game:', error);
            socket.emit('game_error', { message: 'খেলা শুরু করতে সমস্যা হয়েছে' });
        }
    });
    // === MODIFIED CODE END ===

    socket.on('client_submit_combination', (data) => {
        // This is Hazari specific
        try {
            const { roomId, combination } = data;
            const room = gameRooms.get(roomId);
            
            if (!room || room.gameType !== 'hazari' || room.gameState.status !== 'playing') return;
            
            const currentPlayer = room.players[room.gameState.currentPlayerIndex];
            if (currentPlayer.userId !== userId) return socket.emit('game_error', { message: 'এখন আপনার পালা নয়' });
            
            const points = HazariLogic.calculateCombination(combination.cards, combination.type);
            room.gameState.scores[userId] += points;
            room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % 4;
            
            console.log(`User ${username} submitted combination in room ${roomId}`);
            broadcastGameState(roomId);
        } catch (error) {
            console.error('Error submitting combination:', error);
            socket.emit('game_error', { message: 'চাল জমা দিতে সমস্যা হয়েছে' });
        }
    });
    
    // === NEW CODE START ===
    socket.on('client_make_call', (data) => {
        try {
            const { roomId, call } = data;
            const room = gameRooms.get(roomId);

            if (!room || room.gameType !== 'callbreak' || room.gameState.status !== 'bidding') return;

            const currentPlayer = room.players[room.gameState.currentPlayerIndex];
            if (currentPlayer.userId !== userId) return socket.emit('game_error', { message: 'এখন আপনার কল করার পালা নয়' });

            room.gameState.bids[userId] = call;
            room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % 4;

            // Check if all players have made their bid
            const allBidsMade = room.players.every(p => room.gameState.bids[p.userId] !== null);
            if (allBidsMade) {
                room.gameState.status = 'playing';
                // After bidding, the player next to the dealer starts the first hand
                room.gameState.currentPlayerIndex = (room.gameState.dealerIndex + 1) % 4; 
            }

            console.log(`User ${username} made a call of ${call} in room ${roomId}`);
            broadcastGameState(roomId);
        } catch(error) {
            console.error('Error making call:', error);
            socket.emit('game_error', { message: 'কল করতে সমস্যা হয়েছে' });
        }
    });

    socket.on('client_play_card', (data) => {
        try {
            const { roomId, card } = data;
            const room = gameRooms.get(roomId);

            if (!room || room.gameType !== 'callbreak' || room.gameState.status !== 'playing') return;

            const currentPlayer = room.players[room.gameState.currentPlayerIndex];
            if (currentPlayer.userId !== userId) return socket.emit('game_error', { message: 'এখন আপনার পালা নয়' });
            
            // TODO: Add validation logic to check if the played card is valid

            room.gameState.table.push({ userId, card });

            // Remove card from player's hand
            room.gameState.cards[userId] = room.gameState.cards[userId].filter(c => !(c.suit === card.suit && c.value === card.value));

            // If table has 4 cards, determine winner
            if (room.gameState.table.length === 4) {
                const leadingSuit = room.gameState.table[0].card.suit;
                const winner = CallBreakLogic.determineHandWinner(room.gameState.table, leadingSuit);
                room.gameState.handsWon[winner.userId]++;
                
                // Winner of the hand starts the next hand
                room.gameState.currentPlayerIndex = room.players.findIndex(p => p.userId === winner.userId);
                room.gameState.table = []; // Clear table for next hand

                // Check if all 13 hands are played
                const allHandsPlayed = Object.values(room.gameState.cards).every(hand => hand.length === 0);
                if (allHandsPlayed) {
                    // Calculate and update scores
                    const roundScores = CallBreakLogic.calculateRoundScores(room.gameState.bids, room.gameState.handsWon);
                    for (const pId in roundScores) {
                        if (!room.gameState.scores[pId]) room.gameState.scores[pId] = 0;
                        room.gameState.scores[pId] += roundScores[pId];
                    }

                    // Check if game is finished
                    if (room.gameState.currentRound >= room.gameState.totalRounds) {
                        room.gameState.status = 'finished';
                        // Determine overall winner
                    } else {
                        // Start next round (by going back to bidding)
                        room.gameState.status = 'round_over';
                    }
                }
            } else {
                room.gameState.currentPlayerIndex = (room.gameState.currentPlayerIndex + 1) % 4;
            }

            broadcastGameState(roomId);
        } catch(error) {
            console.error('Error playing card:', error);
            socket.emit('game_error', { message: 'কার্ড খেলতে সমস্যা হয়েছে' });
        }
    });
    // === NEW CODE END ===

    socket.on('client_leave_room', (data) => {
        try {
            const { roomId } = data;
            const room = gameRooms.get(roomId);
            
            if (room) {
                room.players = room.players.filter(p => p.userId !== userId);
                if (room.players.length === 0) {
                    gameRooms.delete(roomId);
                    console.log(`Room ${roomId} deleted`);
                } else {
                    // Simplified logic: just reset the game if a player leaves
                    room.gameState.status = 'waiting'; 
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
            const { userId, username } = onlineUsers.get(socket.id);
            console.log(`User ${username} disconnected`);
            onlineUsers.delete(socket.id);
            userSockets.delete(userId);
            io.emit('update_online_users', Array.from(userSockets.keys()));
        }
    });
});


// All Express API routes below remain unchanged.
// ... (Your existing Express routes for login, register, profile etc.)


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
        console.log(`Socket.IO game events are ready for Hazari and Call Break games`);
    });
}

startServer();
