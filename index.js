const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
if (!uri) {
    console.error("MONGO_URI environment variable not set.");
    process.exit(1);
}
const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, usersCollection, gamesCollection, transactionsCollection;
let onlineUsers = new Map(); // socket.id => username

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        gamesCollection = db.collection("games");
        transactionsCollection = db.collection("transactions");
        console.log("MongoDB connection successful!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

// Global function to update online user list for all clients
function updateOnlineUserList() {
    io.emit('update_online_users', Array.from(onlineUsers.values()));
}

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    socket.on('disconnect', () => {
        if (onlineUsers.has(socket.id)) {
            const username = onlineUsers.get(socket.id);
            onlineUsers.delete(socket.id);
            console.log(`${username} (${socket.id}) disconnected.`);
            updateOnlineUserList();
        }
    });
});

// === API Endpoints ===

app.get('/', (req, res) => res.json({ message: 'Welcome to Yaariyan Game Server!' }));

// User Management
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username and password are required." });
    const existingUser = await usersCollection.findOne({ username });
    if (existingUser) return res.status(400).json({ message: "Username already exists." });
    
    await usersCollection.insertOne({ username, password, stats: { gamesPlayed: 0, wins: 0 } });
    res.status(201).json({ message: "User registered successfully!" });
});

app.post('/login', async (req, res) => {
    const { username, password, socketId } = req.body;
    if (!username || !password || !socketId) return res.status(400).json({ message: "Username, password, and socketId are required." });
    
    const user = await usersCollection.findOne({ username });
    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.password !== password) return res.status(401).json({ message: "Incorrect password." });

    onlineUsers.set(socketId, username);
    console.log(`${username} logged in with socket ID: ${socketId}`);
    updateOnlineUserList();
    res.status(200).json({ message: "Login successful!" });
});

app.get('/online-users', (req, res) => {
    res.status(200).json({ users: Array.from(onlineUsers.values()) });
});

// Game Management (Simplified for now, will add detailed logic later)
app.post('/games/create', async (req, res) => {
    const { hostUsername, gameType } = req.body;
    const newGame = {
        host: hostUsername,
        gameType,
        players: [hostUsername],
        status: 'waiting',
        createdAt: new Date()
    };
    const result = await gamesCollection.insertOne(newGame);
    io.emit('update_games'); // Notify all clients to refresh game list
    res.status(201).json({ message: "Game created successfully!", gameId: result.insertedId });
});

app.get('/games/waiting', async (req, res) => {
    const waitingGames = await gamesCollection.find({ status: 'waiting' }).toArray();
    res.status(200).json(waitingGames);
});

app.post('/games/:gameId/join', async (req, res) => {
    const { gameId } = req.params;
    const { username } = req.body;
    const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
    if (game && game.players.length < 4 && !game.players.includes(username)) {
        await gamesCollection.updateOne({ _id: new ObjectId(gameId) }, { $push: { players: username } });
        io.emit('update_games');
        res.status(200).json({ message: "Joined game successfully!" });
    } else {
        res.status(400).json({ message: "Cannot join game. It might be full or you've already joined." });
    }
});

// Khata (Transaction) Management
app.post('/khata/add', async (req, res) => {
    const { fromUser, toUser, amount, reason } = req.body;
    const transaction = { fromUser, toUser, amount: Number(amount), reason, date: new Date(), settled: false };
    await transactionsCollection.insertOne(transaction);
    res.status(201).json({ message: "Transaction added successfully!" });
});

app.get('/khata/:username', async (req, res) => {
    const { username } = req.params;
    const transactionsGiven = await transactionsCollection.find({ fromUser: username, settled: false }).toArray();
    const transactionsTaken = await transactionsCollection.find({ toUser: username, settled: false }).toArray();
    res.status(200).json({ given: transactionsGiven, taken: transactionsTaken });
});

app.put('/khata/settle/:transactionId', async (req, res) => {
    const { transactionId } = req.params;
    await transactionsCollection.updateOne({ _id: new ObjectId(transactionId) }, { $set: { settled: true } });
    res.status(200).json({ message: "Transaction settled." });
});


// Start Server
async function startServer() {
    await connectDB();
    server.listen(port, () => {
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
}

startServer();
