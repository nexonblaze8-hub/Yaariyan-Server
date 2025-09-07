const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcrypt'); // পাসওয়ার্ড সুরক্ষিত করার জন্য নতুন লাইব্রেরি

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

let db, usersCollection, gamesCollection, transactionsCollection, chatsCollection;
let onlineUsers = new Map(); // socket.id => email

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        gamesCollection = db.collection("games");
        transactionsCollection = db.collection("transactions");
        chatsCollection = db.collection("chats");
        console.log("MongoDB connection successful!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

// === API Endpoints ===
app.get('/', (req, res) => res.json({ message: 'Welcome to Yaariyan Game Server!' }));

// --- নতুন এবং উন্নত রেজিস্ট্রেশন প্রক্রিয়া ---
app.post('/register', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;

        // 1. প্রয়োজনীয় তথ্য চেক করা
        if (!fullName || !email || !password) {
            return res.status(400).json({ success: false, message: "সম্পূর্ণ নাম, ইমেল এবং পাসওয়ার্ড आवश्यक।" });
        }

        // 2. ইমেলটি আগে থেকেই আছে কিনা তা চেক করা
        const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "এই ইমেলটি আগে থেকেই রেজিস্টার করা আছে।" });
        }

        // 3. পাসওয়ার্ডকে সুরক্ষিত (Hash) করা
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. নতুন ব্যবহারকারীর কাঠামো তৈরি করা
        const newUser = {
            fullName,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'user', // ডিফল্ট ভূমিকা 'user'
            status: 'pending', // ডিফল্ট স্ট্যাটাস 'pending'
            createdAt: new Date()
        };

        // 5. ডেটাবেসে নতুন ব্যবহারকারীকে সেভ করা
        await usersCollection.insertOne(newUser);

        // 6. সফল বার্তা পাঠানো
        res.status(201).json({
            success: true,
            message: "রেজিস্ট্রেশন সফল হয়েছে! অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।"
        });

    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে। অনুগ্রহ করে পরে চেষ্টা করুন।" });
    }
});


// --- লগইন প্রক্রিয়া (এখনও সম্পূর্ণ নয়, পরবর্তী ধাপে করা হবে) ---
app.post('/login', async (req, res) => {
    // এই অংশটি আমরা পরের ধাপে তৈরি করব
    res.status(501).json({ message: "লগইন প্রক্রিয়া এখনও তৈরি হয়নি।" });
});


// পুরোনো কোড (আপাতত কোনো পরিবর্তন করা হয়নি)
app.get('/profile/:username', async (req, res) => {
    // This will be updated later to use email or user ID
    const { username } = req.params;
    const user = await usersCollection.findOne({ username }, { projection: { password: 0 } });
    if (user) {
        res.status(200).json(user);
    } else {
        res.status(404).json({ message: "User not found." });
    }
});


// সার্ভার চালু করা
async function startServer() {
    await connectDB();
    server.listen(port, () => {
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
}

startServer();
