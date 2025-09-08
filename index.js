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

// --- নতুন ফাংশন: সার্ভার চালু হওয়ার সময় Admin অ্যাকাউন্ট তৈরি করার জন্য ---
async function setupAdminAccount() {
    const ADMIN_USERNAME = "Mtr@rkS";
    const ADMIN_PASSWORD = "264148";

    try {
        const adminUser = await usersCollection.findOne({ username: ADMIN_USERNAME.toLowerCase() });

        if (!adminUser) {
            console.log("Admin account not found. Creating a new one...");
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);

            const newAdmin = {
                fullName: "MTR (Admin)",
                email: "admin@yaariyan.local", // একটি ডিফল্ট ইমেল
                username: ADMIN_USERNAME.toLowerCase(),
                password: hashedPassword,
                role: 'admin',
                status: 'approved',
                createdAt: new Date()
            };
            await usersCollection.insertOne(newAdmin);
            console.log("Admin account created successfully!");
        } else {
            console.log("Admin account verified.");
        }
    } catch (error) {
        console.error("Error during admin account setup:", error);
    }
}
// --- ফাংশন শেষ ---


app.get('/', (req, res) => res.json({ message: 'Welcome to Yaariyan Game Server!' }));

app.post('/register', async (req, res) => {
    try {
        // --- নতুন পরিবর্তন: username যোগ করা হয়েছে ---
        const { fullName, email, password, username } = req.body;
        if (!fullName || !email || !password || !username) {
            return res.status(400).json({ success: false, message: "সম্পূর্ণ নাম, ইমেল, ইউজারনেম এবং পাসওয়ার্ড आवश्यक।" });
        }
        
        // ইমেল এবং ইউজারনেম ইউনিক কিনা তা পরীক্ষা করা হচ্ছে
        const existingUser = await usersCollection.findOne({ $or: [{email: email.toLowerCase()}, {username: username.toLowerCase()}] });
        if (existingUser) {
            if (existingUser.email === email.toLowerCase()) {
                 return res.status(400).json({ success: false, message: "এই ইমেলটি আগে থেকেই রেজিস্টার করা আছে।" });
            }
            if (existingUser.username === username.toLowerCase()) {
                 return res.status(400).json({ success: false, message: "এই ইউজারনেমটি অন্য কেউ ব্যবহার করছে।" });
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = {
            fullName,
            email: email.toLowerCase(),
            username: username.toLowerCase(), // <-- ইউজারনেম সেভ করা হচ্ছে
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
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" });
    }
});

app.post('/login', async (req, res) => {
    try {
        // --- নতুন পরিবর্তন: 'identifier' দিয়ে লগইন ---
        const { identifier, password } = req.body;
        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: "অনুগ্রহ করে ইউজারনেম/ইমেল এবং পাসওয়ার্ড দিন।" });
        }

        // ইউজারনেম অথবা ইমেল দিয়ে ব্যবহারকারীকে খোঁজা হচ্ছে
        const user = await usersCollection.findOne({
            $or: [
                { email: identifier.toLowerCase() },
                { username: identifier.toLowerCase() }
            ]
        });

        if (!user) {
            return res.status(404).json({ success: false, message: "এই ইউজারনেম বা ইমেল দিয়ে কোনো অ্যাকাউন্ট খুঁজে পাওয়া যায়নি।" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "ভুল পাসওয়ার্ড।" });
        }
        if (user.status !== 'approved') {
            return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি এখনও অনুমোদিত হয়নি।" });
        }
        res.status(200).json({
            success: true,
            message: "লগইন সফল হয়েছে!",
            user: {
                fullName: user.fullName,
                email: user.email,
                username: user.username,
                role: user.role
            }
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" });
    }
});

async function startServer() {
    await connectDB();
    await setupAdminAccount(); // <-- সার্ভার চালু হওয়ার সময় Admin অ্যাকাউন্ট সেটআপ করা হচ্ছে
    server.listen(port, () => {
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
}

startServer();
