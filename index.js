const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcrypt');

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

let db, usersCollection;
async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        console.log("MongoDB connection successful!");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
        process.exit(1);
    }
}

app.get('/', (req, res) => res.json({ message: 'Welcome to Yaariyan Game Server!' }));

app.post('/register', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        if (!fullName || !email || !password) {
            return res.status(400).json({ success: false, message: "সম্পূর্ণ নাম, ইমেল এবং পাসওয়ার্ড आवश्यक।" });
        }
        const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "এই ইমেলটি আগে থেকেই রেজিস্টার করা আছে।" });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = {
            fullName,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'user',
            status: 'pending',
            createdAt: new Date()
        };
        await usersCollection.insertOne(newUser);
        res.status(201).json({
            success: true,
            message: "রেজিস্ট্রেশন সফল হয়েছে! অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।"
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে। অনুগ্রহ করে পরে চেষ্টা করুন।" });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "অনুগ্রহ করে ইমেল এবং পাসওয়ার্ড দিন।" });
        }

        const user = await usersCollection.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(404).json({ success: false, message: "এই ইমেল দিয়ে কোনো অ্যাকাউন্ট খুঁজে পাওয়া যায়নি।" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "ভুল পাসওয়ার্ড। অনুগ্রহ করে আবার চেষ্টা করুন।" });
        }

        if (user.status !== 'approved') {
            return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি এখনও অনুমোদিত হয়নি। অনুগ্রহ করে অনুমোদনের জন্য অপেক্ষা করুন।" });
        }

        res.status(200).json({
            success: true,
            message: "লগইন সফল হয়েছে!",
            user: {
                fullName: user.fullName,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে। অনুগ্রহ করে পরে চেষ্টা করুন।" });
    }
});

async function startServer() {
    await connectDB();
    server.listen(port, () => {
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
}

startServer();
