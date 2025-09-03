// আগের সব require এবং কানেকশন কোড একই থাকবে
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, usersCollection, gamesCollection;

async function connectDB() { /* ... এই ফাংশনটি আগের মতোই থাকবে ... */ }

let onlineUsers = new Map();

io.on('connection', (socket) => { /* ... এই অংশটিও আগের মতোই থাকবে ... */ });

// API Endpoints
app.get('/', (req, res) => res.json({ message: 'Yaariyan Game Server is running!' }));
app.post('/register', async (req, res) => { /* ... আগের মতোই ... */ });
app.post('/login', async (req, res) => { /* ... আগের মতোই ... */ });
app.get('/online-users', (req, res) => { /* ... আগের মতোই ... */ });

// --- *** গেমের জন্য নতুন এবং আপডেট করা কোড *** ---

// একটি নতুন গেম টেবিল তৈরি করা
app.post('/games/create', async (req, res) => {
    const { hostUsername } = req.body;
    if (!hostUsername) {
        return res.status(400).json({ message: "Host username is required." });
    }
    const newGame = {
        host: hostUsername,
        players: [hostUsername],
        status: 'waiting', // খেলার অবস্থা 'waiting'
        createdAt: new Date()
    };
    try {
        const result = await gamesCollection.insertOne(newGame);
        // নতুন গেম তৈরি হওয়ার খবর সব ক্লায়েন্টকে পাঠানো হচ্ছে
        io.emit('new_game_created');
        res.status(201).json({ message: "Game created successfully!", gameId: result.insertedId });
    } catch (error) {
        res.status(500).json({ message: "Failed to create game." });
    }
});

// অপেক্ষারত (waiting) গেমগুলোর তালিকা পাঠানো
app.get('/games/waiting', async (req, res) => {
    try {
        const waitingGames = await gamesCollection.find({ status: 'waiting' }).toArray();
        res.status(200).json(waitingGames);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch waiting games." });
    }
});

// একটি গেমে যোগ দেওয়া
app.post('/games/:gameId/join', async (req, res) => {
    const { gameId } = req.params;
    const { username } = req.body;
    try {
        const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
        if (game && game.players.length < 4 && !game.players.includes(username)) {
            await gamesCollection.updateOne(
                { _id: new ObjectId(gameId) },
                { $push: { players: username } }
            );
            // গেমে পরিবর্তন আসার খবর সব ক্লায়েন্টকে পাঠানো হচ্ছে
            io.emit('game_updated');
            res.status(200).json({ message: "Joined game successfully!" });
        } else {
            res.status(400).json({ message: "Cannot join game. It might be full or you've already joined." });
        }
    } catch (error) {
        res.status(500).json({ message: "Error joining game." });
    }
});

// --- *** বাকি অংশ আগের মতোই থাকবে *** ---

async function startServer() {
    await connectDB();
    server.listen(port, () => {
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
}

startServer();
