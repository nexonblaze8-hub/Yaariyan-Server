const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
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
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, usersCollection;
let onlineUsers = new Set();

async function connectAndStartServer() {
  try {
    // Connect to the database
    await client.connect();
    db = client.db("YaariyanDB");
    usersCollection = db.collection("users");
    console.log("MongoDB connection successful!");

    // Start the Express server only after the DB connection is successful
    app.listen(port, () => {
        console.log(`Yaariyan Server is live on port ${port}`);
    });

  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

// --- API Endpoints ---
app.get('/', (req, res) => {
    res.json({ message: 'Yaariyan Server is running!' });
});

app.get('/online-users', (req, res) => {
    res.status(200).json({ users: Array.from(onlineUsers) });
});

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

// Start the whole process
connectAndStartServer();
