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

let db, gamesCollection;

const suits = ['H', 'D', 'C', 'S'];
const values = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function createDeck() { return suits.flatMap(suit => values.map(value => ({ value, suit }))); }
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
    db = client.db("YaariyanGameDB");
    gamesCollection = db.collection("games");
    console.log("MongoDB connection successful!");
    app.listen(port, () => {
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

// API Endpoints
app.get('/', (req, res) => res.json({ message: 'Yaariyan Game Server is running!' }));

app.post('/games/create', async (req, res) => {
    const { host } = req.body;
    const newGame = {
        host,
        players: [{ username: host, cards: [], isReady: false }],
        status: 'waiting',
        createdAt: new Date()
    };
    const result = await gamesCollection.insertOne(newGame);
    res.status(201).json({ gameId: result.insertedId });
});

app.get('/games/waiting', async (req, res) => {
    const games = await gamesCollection.find({ status: 'waiting' }).toArray();
    res.status(200).json(games);
});

app.post('/games/:gameId/join', async (req, res) => {
    const { gameId } = req.params;
    const { username } = req.body;
    try {
        const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
        if (game && game.players.length < 4 && !game.players.some(p => p.username === username)) {
            await gamesCollection.updateOne({ _id: new ObjectId(gameId) }, { $push: { players: { username, cards: [], isReady: false } } });
            res.status(200).json({ message: "Joined successfully!" });
        } else { res.status(400).json({ message: "Game full or already joined." }); }
    } catch(err) { res.status(500).json({message: "Error joining game"}) }
});

app.post('/games/:gameId/ready', async (req, res) => {
    const { gameId } = req.params;
    const { username } = req.body;
    await gamesCollection.updateOne(
        { _id: new ObjectId(gameId), "players.username": username },
        { $set: { "players.$.isReady": true } }
    );
    
    const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
    const allReady = game.players.every(p => p.isReady);

    if (game.players.length === 4 && allReady) {
        const deck = shuffleDeck(createDeck());
        const updatedPlayers = game.players.map((player, index) => {
            player.cards = deck.slice(index * 13, (index + 1) * 13);
            return player;
        });
        await gamesCollection.updateOne({ _id: new ObjectId(gameId) }, { $set: { players: updatedPlayers, status: 'in-progress' } });
    }
    res.status(200).json({ message: "Ready status updated." });
});

app.get('/games/:gameId/state/:username', async (req, res) => {
    const { gameId, username } = req.params;
    try {
        const game = await gamesCollection.findOne({ _id: new ObjectId(gameId) });
        if(game){
            const myPlayer = game.players.find(p => p.username === username);
            // Send the full game state but only my cards
            const stateToSend = { ...game, myCards: myPlayer ? myPlayer.cards : [] };
            delete stateToSend.players; // For simplicity, we can handle player info separately if needed
            stateToSend.playersInfo = game.players.map(p => ({ username: p.username, cardCount: p.cards.length, isReady: p.isReady }));
            res.status(200).json(stateToSend);
        } else { res.status(404).json({message: "Game not found."})}
    } catch(err) { res.status(500).json({message: "Error fetching game state"}) }
});


connectAndStartServer();
