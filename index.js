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
let onlineUsers = []; // অনলাইন ব্যবহারকারীদের তালিকা

async function connectDB() {
  try {
    await client.connect();
    console.log("MongoDB ডেটাবেসের সাথে সফলভাবে সংযোগ হয়েছে!");
    const db = client.db("YaariyanDB");
    usersCollection = db.collection("users");
  } catch (err) {
    console.error("ডেটাবেস সংযোগে সমস্যা হয়েছে:", err);
    process.exit(1);
  }
}

// সার্ভার চালু আছে কিনা তা পরীক্ষা করার জন্য
app.get('/', (req, res) => {
    res.json({ message: 'Yaariyan Server is live and working correctly!' });
});

// অনলাইন ব্যবহারকারীদের তালিকা পাঠানোর জন্য
app.get('/online-users', (req, res) => {
    res.status(200).json({ users: onlineUsers });
});

// ব্যবহারকারীর পরিসংখ্যান (জয়/হার) পাঠানোর জন্য নতুন এন্ডপয়েন্ট
app.get('/user-stats/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const user = await usersCollection.findOne({ username: username });
        if (user) {
            res.status(200).json({ wins: user.wins, losses: user.losses });
        } else {
            res.status(404).json({ message: "ব্যবহারকারী খুঁজে পাওয়া যায়নি" });
        }
    } catch (err) {
        res.status(500).json({ message: "সার্ভারে একটি সমস্যা হয়েছে" });
    }
});

// রেজিস্ট্রেশন
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) { return res.status(400).json({ message: "ইউজারনেম এবং পাসওয়ার্ড দিন" }); }
    try {
        const existingUser = await usersCollection.findOne({ username: username });
        if (existingUser) { return res.status(400).json({ message: "এই ইউজারনেমটি 이미 ব্যবহৃত" }); }
        await usersCollection.insertOne({ username, password, wins: 0, losses: 0, createdAt: new Date() });
        res.status(201).json({ message: "রেজিস্ট্রেশন সফল হয়েছে!" });
    } catch (err) { res.status(500).json({ message: "সার্ভারে একটি সমস্যা হয়েছে" }); }
});

// লগইন
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) { return res.status(400).json({ message: "ইউজারনেম এবং পাসওয়ার্ড দিন" }); }
    try {
        const user = await usersCollection.findOne({ username: username });
        if (!user) { return res.status(404).json({ message: "এই নামে কোনো ব্যবহারকারী নেই" }); }
        if (user.password !== password) { return res.status(401).json({ message: "ভুল পাসওয়ার্ড" }); }
        if (!onlineUsers.includes(username)) { onlineUsers.push(username); }
        res.status(200).json({ message: "লগইন সফল হয়েছে!" });
    } catch (err) { res.status(500).json({ message: "সার্ভারে একটি সমস্যা হয়েছে" }); }
});

// লগ-আউট করার জন্য নতুন এন্ডপয়েন্ট
app.post('/logout', (req, res) => {
    const { username } = req.body;
    if (username) {
        onlineUsers = onlineUsers.filter(user => user !== username);
    }
    res.status(200).json({ message: "লগ-আউট সফল হয়েছে" });
});

async function startServer() {
    await connectDB();
    app.listen(port, () => {
        console.log(`'Yaariyan' সার্ভার চালু হয়েছে http://localhost:${port} এই ঠিকানায়`);
    });
}

startServer();
