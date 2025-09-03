const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let usersCollection;
let gamesCollection; // খেলার তথ্য রাখার জন্য নতুন collection
let onlineUsers = new Set(); // অনলাইন ব্যবহারকারীদের তালিকা রাখার জন্য Set ব্যবহার করা হচ্ছে

async function connectDB() {
  try {
    await client.connect();
    console.log("MongoDB ডেটাবেসের সাথে সফলভাবে সংযোগ হয়েছে!");
    const db = client.db("YaariyanDB");
    usersCollection = db.collection("users");
    gamesCollection = db.collection("games"); // নতুন games collection
  } catch (err) {
    console.error("ডেটাবেস সংযোগে সমস্যা হয়েছে:", err);
    process.exit(1);
  }
}

// --- API Endpoints ---

app.get('/', (req, res) => res.json({ message: 'Yaariyan Server is live!' }));

// User Authentication
app.post('/register', async (req, res) => {
    // ... আগের মতোই ...
});
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    // ... আগের মতোই ...
    // সফল লগইনের পর, অনলাইন তালিকায় যোগ করা হবে
    onlineUsers.add(username);
    res.status(200).json({ message: "লগইন সফল হয়েছে!", user: { username: user.username, wins: user.wins, losses: user.losses } });
});
app.post('/logout', (req, res) => {
    const { username } = req.body;
    if (username) {
        onlineUsers.delete(username);
    }
    res.status(200).json({ message: "লগ-আউট সফল হয়েছে" });
});
app.get('/online-users', (req, res) => res.status(200).json({ users: Array.from(onlineUsers) }));
app.get('/user-stats/:username', async (req, res) => {
    // ... আগের মতোই ...
});

// --- নতুন Game API Endpoints ---

// নতুন খেলা তৈরি করার জন্য
app.post('/games/create', async (req, res) => {
    const { createdBy, gameType } = req.body;
    const newGame = {
        gameType,
        host: createdBy,
        players: [createdBy],
        status: 'waiting', // waiting, in-progress, finished
        createdAt: new Date()
    };
    const result = await gamesCollection.insertOne(newGame);
    res.status(201).json(result.ops[0]);
});

// চলমান খেলাগুলোর তালিকা পাঠানোর জন্য
app.get('/games', async (req, res) => {
    const waitingGames = await gamesCollection.find({ status: 'waiting' }).toArray();
    res.status(200).json(waitingGames);
});

// খেলায় যোগ দেওয়ার জন্য
app.post('/games/:gameId/join', async (req, res) => {
    const { gameId } = req.params;
    const { username } = req.body;
    
    const game = await gamesCollection.findOne({ _id: new MongoClient.ObjectID(gameId) });

    if (game.players.length < 4 && !game.players.includes(username)) {
        await gamesCollection.updateOne({ _id: new MongoClient.ObjectID(gameId) }, { $push: { players: username } });
        res.status(200).json({ message: "খেলায় সফলভাবে যোগ দিয়েছেন!" });
    } else {
        res.status(400).json({ message: "টেবিল পূর্ণ বা আপনি ইতিমধ্যেই এই খেলায় আছেন।" });
    }
});

async function startServer() {
    await connectDB();
    app.listen(port, () => console.log(`'Yaariyan' সার্ভার চালু হয়েছে`));
}

startServer();
