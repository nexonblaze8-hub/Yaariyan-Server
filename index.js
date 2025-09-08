const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-key-for-yaariyan';

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

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ success: false, message: 'Token not provided' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Token is invalid' });
        req.user = user;
        next();
    });
};

const authorizeAdminOrCoLeader = async (req, res, next) => {
    try {
        const userInDb = await usersCollection.findOne({ email: req.user.email });
        if (userInDb && (userInDb.role === 'admin' || userInDb.role === 'co-leader')) {
            next();
        } else {
            res.status(403).json({ success: false, message: "এই কাজটি করার জন্য আপনার অনুমতি নেই।" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "অনুমতি যাচাই করার সময় সার্ভারে সমস্যা হয়েছে।" });
    }
};

app.get('/', (req, res) => res.json({ message: 'Welcome to Yaariyan Game Server!' }));

app.post('/register', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        if (!fullName || !email || !password) return res.status(400).json({ success: false, message: "সম্পূর্ণ নাম, ইমেল এবং পাসওয়ার্ড आवश्यक।" });
        const existingUser = await usersCollection.findOne({ email: email.toLowerCase() });
        if (existingUser) return res.status(400).json({ success: false, message: "এই ইমেলটি আগে থেকেই রেজিস্টার করা আছে।" });
        
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
        res.status(201).json({ success: true, message: "রেজিস্ট্রেশন সফল হয়েছে! অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।" });
    } catch (error) {
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "অনুগ্রহ করে ইমেল এবং পাসওয়ার্ড দিন।" });

        const user = await usersCollection.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ success: false, message: "এই ইমেল দিয়ে কোনো অ্যাকাউন্ট খুঁজে পাওয়া যায়নি।" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "ভুল পাসওয়ার্ড।" });

        if (user.status !== 'approved') return res.status(403).json({ success: false, message: "আপনার অ্যাকাউন্টটি এখনও অনুমোদিত হয়নি।" });

        const accessToken = jwt.sign({ email: user.email, role: user.role, fullName: user.fullName }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({
            success: true,
            message: "লগইন সফল হয়েছে!",
            token: accessToken,
            user: { fullName: user.fullName, email: user.email, role: user.role }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "লগইন করার সময় সার্ভারে সমস্যা হয়েছে।" });
    }
});

app.get('/pending-users', authenticateToken, authorizeAdminOrCoLeader, async (req, res) => {
    try {
        const pendingUsers = await usersCollection.find({ status: 'pending' }).project({ password: 0 }).toArray();
        res.status(200).json({ success: true, users: pendingUsers });
    } catch (error) {
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" });
    }
});

app.post('/approve-user/:userId', authenticateToken, authorizeAdminOrCoLeader, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: { status: 'approved' } });
        if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: "ব্যবহারকারীকে খুঁজে পাওয়া যায়নি বা ইতিমধ্যেই অনুমোদিত।" });
        res.status(200).json({ success: true, message: "ব্যবহারকারীকে সফলভাবে অনুমোদন করা হয়েছে।" });
    } catch (error) {
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" });
    }
});

app.delete('/reject-user/:userId', authenticateToken, authorizeAdminOrCoLeader, async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await usersCollection.deleteOne({ _id: new ObjectId(userId) });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: "ব্যবহারকারীকে খুঁজে পাওয়া যায়নি।" });
        res.status(200).json({ success: true, message: "ব্যবহারকারীকে সফলভাবে মুছে ফেলা হয়েছে।" });
    } catch (error) {
        res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" });
    }
});

async function startServer() {
    await connectDB();
    server.listen(port, () => console.log(`Yaariyan Game Server is live on port ${port}`));
}

startServer();
