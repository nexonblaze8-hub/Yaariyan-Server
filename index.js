const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let usersCollection;

async function connectDB() {
  try {
    await client.connect();
    console.log("MongoDB database connection established successfully!");
    const db = client.db("YaariyanDB");
    usersCollection = db.collection("users");
  } catch (err) {
    console.error("Database connection failed:", err);
    process.exit(1);
  }
}

app.get('/', (req, res) => {
    res.json({ message: 'Yaariyan Server is live and ready!' });
});

app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: "ইউজারনেম এবং পাসওয়ার্ড দিন" });
    }
    try {
        const existingUser = await usersCollection.findOne({ username: username });
        if (existingUser) {
            return res.status(400).json({ message: "এই ইউজারনেমটি 이미 ব্যবহৃত" });
        }
        await usersCollection.insertOne({ username, password, wins: 0, losses: 0, createdAt: new Date() });
        res.status(201).json({ message: "রেজিস্ট্রেশন সফল হয়েছে!" });
    } catch (err) {
        res.status(500).json({ message: "সার্ভারে একটি সমস্যা হয়েছে" });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: "ইউজারনেম এবং পাসওয়ার্ড দিন" });
    }
    try {
        const user = await usersCollection.findOne({ username: username });
        if (!user) {
            return res.status(404).json({ message: "এই নামে কোনো ব্যবহারকারী নেই" });
        }
        if (user.password !== password) {
            return res.status(401).json({ message: "ভুল পাসওয়ার্ড" });
        }
        res.status(200).json({ message: "লগইন সফল হয়েছে!" });
    } catch (err) {
        res.status(500).json({ message: "সার্ভারে একটি সমস্যা হয়েছে" });
    }
});

async function startServer() {
    await connectDB();
    app.listen(port, () => {
        console.log(`Yaariyan Server is listening on port ${port}`);
    });
}

startServer();
