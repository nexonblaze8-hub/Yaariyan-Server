const express = require('express');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

if (!uri) {
    console.error("MONGO_URI environment variable not set.");
    process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db, usersCollection, gamesCollection;
let onlineUsers = new Set();

const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function createDeck() {
    return suits.flatMap(suit => values.map(value => ({ value, suit })));
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

async function connectAndStartServer() {
  try {
    await client.connect();
    db = client.db("YaariyanDB");
    usersCollection = db.collection("users");
    gamesCollection = db.collection("games");
    console.log("MongoDB connection successful!");

    app.listen(port, () => {
        console.log(`Yaariyan Server is live on port ${port}`);
    });

  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

// --- API Endpoints ---
app.get('/', (req, res) => res.json({ message: 'Yaariyan Server is running!' }));
// ... (Login, Register, Logout endpoints are unchanged)
app.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: "Username and password required" });
        const existingUser = await usersCollection.findOne({ username });
        if (existingUser) return res.status(400).json({ message: "এই ইউজারনেমটি 이미 ব্যবহৃত" });
        await usersCollection.insertOne({ username, password, wins: 0, losses: 0, createdAt: new Date() });
        res.status(201).json({ message: "রেজিস্ট্রেশন সফল হয়েছে!" });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) return res.status(400).json({ message: "Username and password required" });
        const user = await usersCollection.findOne({ username });
        if (!user) return res.status(404).json({ message: "এই নামে কোনো ব্যবহারকারী নেই" });
        if (user.password !== password) return res.status(401).json({ message: "ভুল পাসওয়ার্ড" });
        onlineUsers.add(username);
        res.status(200).json({ message: "লগইন সফল হয়েছে!" });
    } catch (err) { res.status(500).json({ message: "Server error" }); }
});

app.post('/logout', (req, res) => {
    const { username } = req.body;
    if (username) onlineUsers.delete(username);
    res.status(200).json({ message: "Logout successful" });
});


// --- Game Endpoints ---
app.post('/games/create', async (req, res) => {
    const { createdBy, gameType } = req.body;
    const newGame = {
        gameType,
        host: createdBy,
        players: [{ username: createdBy, cards: [] }],
        status: 'waiting',
        createdAt: new Date()
    };
    const result = await gamesCollection.insertOne(newGame);
    res.status(201).json({ gameId: result.insertedId });
});

app.get('/games/waiting', async (req, res) => {
    const waitingGames = await gamesCollection.find({ status: 'waiting' }).toArray();
    res.status(200).json(waitingGames);
});

app.post('/games/:gameId/join', async (req, res) => {
    const { gameId } = req.params;
    const { username } = req.body;
    try {
        const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
        if (game && game.players.length < 4 && !game.players.some(p => p.username === username)) {
            await gamesCollection.updateOne(
                { _id: new ObjectId(gameId) },
                { $push: { players: { username: username, cards: [] } } }
            );
            res.status(200).json({ message: "Joined successfully!" });
        } else {
            res.status(400).json({ message: "Game is full or you are already in it." });
        }
    } catch(err) { res.status(500).json({message: "Error joining game"}) }
});

app.post('/games/:gameId/start', async (req, res) => {
    const { gameId } = req.params;
    try {
        let game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });

        while (game.players.length < 4) {
            game.players.push({ username: `Bot${game.players.length + 1}`, cards: [], isBot: true });
        }

        const deck = shuffleDeck(createDeck());
        game.players.forEach((player, index) => {
            player.cards = deck.slice(index * 13, (index + 1) * 13);
        });

        await gamesCollection.updateOne(
            { _id: new ObjectId(gameId) },
            { $set: { players: game.players, status: 'in-progress' } }
        );
        res.status(200).json({ message: "Game started!" });
    } catch (err) { res.status(500).json({message: "Error starting game"}) }
});

app.get('/games/:gameId/state', async (req, res) => {
    const { gameId } = req.params;
    try {
        const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
        res.status(200).json(game);
    } catch(err) { res.status(500).json({message: "Error fetching game state"}) }
});

connectAndStartServer();
