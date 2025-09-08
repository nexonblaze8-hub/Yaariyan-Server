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
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-yaariyan';

if (!uri) { console.error("MONGO_URI environment variable not set."); process.exit(1); }
const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, usersCollection;
async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        usersCollection = db.collection("users");
        console.log("MongoDB connection successful!");
    } catch (err) { console.error("Failed to connect to MongoDB", err); process.exit(1); }
}

async function setupAdminAccount() {
    const ADMIN_USERNAME = "Mtr@rkS";
    const ADMIN_PASSWORD = "264148";
    try {
        const adminUser = await usersCollection.findOne({ username: ADMIN_USERNAME.toLowerCase() });
        if (!adminUser) {
            console.log("Admin account not found. Creating a new one...");
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);
            const newAdmin = { fullName: "MTR (Admin)", email: "admin@yaariyan.local", username: ADMIN_USERNAME.toLowerCase(), password: hashedPassword, role: 'admin', status: 'approved', profilePictureUrl: "", bio: "Yaariyan App-এর অ্যাডমিনিস্ট্রেটর।", createdAt: new Date() };
            await usersCollection.insertOne(newAdmin);
            console.log("Admin account created successfully!");
        } else { console.log("Admin account verified."); }
    } catch (error) { console.error("Error during admin account setup:", error); }
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

app.post('/register', async (req, res) => {
    try {
        const { fullName, email, password, username } = req.body;
        if (!fullName || !email || !password || !username) return res.status(400).json({ success: false, message: "সম্পূর্ণ তথ্য দিন।" });
        const existingUser = await usersCollection.findOne({ $or: [{email: email.toLowerCase()}, {username: username.toLowerCase()}] });
        if (existingUser) return res.status(400).json({ success: false, message: "এই ইমেল বা ইউজারনেমটি ব্যবহৃত হয়েছে।" });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = { fullName, email: email.toLowerCase(), username: username.toLowerCase(), password: hashedPassword, role: 'user', status: 'pending', profilePictureUrl: "", bio: "", createdAt: new Date() };
        await usersCollection.insertOne(newUser);
        res.status(201).json({ success: true, message: "রেজিস্ট্রেশন সফল! অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।" });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});

app.post('/login', async (req, res) => {
    try {
        const { identifier, password } = req.body;
        if (!identifier || !password) return res.status(400).json({ success: false, message: "অনুগ্রহ করে সঠিক তথ্য দিন।" });
        const user = await usersCollection.findOne({ $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }] });
        if (!user) return res.status(404).json({ success: false, message: "ব্যবহারকারীকে খুঁজে পাওয়া যায়নি।" });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "ভুল পাসওয়ার্ড।" });
        const accessToken = jwt.sign({ userId: user._id.toString(), email: user.email, role: user.role, fullName: user.fullName, username: user.username, status: user.status }, JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ success: true, message: "লগইন সফল!", token: accessToken });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});

// --- নতুন API: প্রোফাইল তথ্য পাওয়ার জন্য ---
app.get('/get-profile', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const userProfile = await usersCollection.findOne(
            { _id: new ObjectId(userId) },
            { projection: { password: 0, _id: 0 } } // পাসওয়ার্ড এবং আইডি ছাড়া বাকি সব তথ্য পাঠানো হচ্ছে
        );
        if (!userProfile) return res.status(404).json({ success: false, message: "প্রোফাইল খুঁজে পাওয়া যায়নি।" });
        res.status(200).json({ success: true, profile: userProfile });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে সমস্যা হয়েছে।" }); }
});

// --- নতুন API: প্রোফাইল আপডেট করার জন্য ---
app.post('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { fullName, bio } = req.body;
        const userId = req.user.userId;
        if (!fullName) return res.status(400).json({ success: false, message: "সম্পূর্ণ নাম आवश्यक।" });
        await usersCollection.updateOne({ _id: new ObjectId(userId) }, { $set: { fullName, bio } });
        res.status(200).json({ success: true, message: "প্রোফাইল সফলভাবে আপডেট করা হয়েছে।" });
    } catch (error) { res.status(500).json({ success: false, message: "সার্ভারে একটি সমস্যা হয়েছে।" }); }
});


async function startServer() {
    await connectDB();
    await setupAdminAccount();
    server.listen(port, () => { console.log(`Yaariyan Game Server is live on port ${port}`); });
}
startServer();
