const express = require('express');
const http = require('http'); // Socket.IO-এর জন্য http প্রয়োজন
const { Server } = require("socket.io"); // Socket.IO যোগ করা হলো
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const server = http.createServer(app); // Express অ্যাপটিকে http সার্ভারের সাথে যুক্ত করা হলো
const io = new Server(server, {
    cors: {
        origin: "*", // সব জায়গা থেকে কানেকশন গ্রহণ করার জন্য
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = process.env.MONGO_URI;
if (!uri) {
    console.error("MONGO_URI environment variable not set.");
    process.exit(1);
}
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db, usersCollection, gamesCollection;

async function connectDB() {
  try {
    await client.connect();
    db = client.db("YaariyanGameDB");
    usersCollection = db.collection("users");
    gamesCollection = db.collection("games");
    console.log("MongoDB connection successful!");
  } catch (err) {
    console.error("Failed to connect to MongoDB", err);
    process.exit(1);
  }
}

// --- নতুন কোড: অনলাইন ইউজারদের ট্র্যাক করার জন্য ---
let onlineUsers = new Map(); // socket.id => username

// Socket.IO Connection Logic
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    socket.on('disconnect', () => {
        if (onlineUsers.has(socket.id)) {
            const username = onlineUsers.get(socket.id);
            onlineUsers.delete(socket.id);
            console.log(`${username} (${socket.id}) disconnected.`);
            // সবাইকে নতুন অনলাইন তালিকা পাঠান
            io.emit('update_online_users', Array.from(onlineUsers.values()));
        }
    });
});
// --- নতুন কোড শেষ ---

// API Endpoints
app.get('/', (req, res) => res.json({ message: 'Yaariyan Game Server is running!' }));

// User Registration
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required." });
    }
    const existingUser = await usersCollection.findOne({ username });
    if (existingUser) {
        return res.status(400).json({ message: "Username already exists." });
    }
    await usersCollection.insertOne({ username, password });
    res.status(201).json({ message: "User registered successfully!" });
});

// User Login
app.post('/login', async (req, res) => {
    const { username, password, socketId } = req.body; // অ্যাপ থেকে socketId নেওয়া হবে
    if (!username || !password || !socketId) {
        return res.status(400).json({ message: "Username, password and socketId are required." });
    }
    const user = await usersCollection.findOne({ username });
    if (!user) {
        return res.status(404).json({ message: "User not found." });
    }
    if (user.password !== password) {
        return res.status(401).json({ message: "Incorrect password." });
    }

    // --- নতুন কোড: লগইন সফল হলে ইউজারকে অনলাইন হিসেবে চিহ্নিত করা ---
    onlineUsers.set(socketId, username);
    console.log(`${username} logged in with socket ID: ${socketId}`);
    // সবাইকে নতুন অনলাইন তালিকা পাঠান
    io.emit('update_online_users', Array.from(onlineUsers.values()));
    // --- নতুন কোড শেষ ---
    
    res.status(200).json({ message: "Login successful!" });
});

// --- নতুন API রুট: অনলাইন ইউজারদের তালিকা পাওয়ার জন্য ---
app.get('/online-users', (req, res) => {
    res.status(200).json({ users: Array.from(onlineUsers.values()) });
});
// --- নতুন API রুট শেষ ---


// Game Logic (আপনার আগের কোড)
app.post('/games/create', async (req, res) => { /* ... আপনার আগের কোড ... */ });
app.get('/games/waiting', async (req, res) => { /* ... আপনার আগের কোড ... */ });
app.post('/games/:gameId/join', async (req, res) => { /* ... আপনার আগের কোড ... */ });
app.post('/games/:gameId/ready', async (req, res) => { /* ... আপনার আগের কোড ... */ });
app.get('/games/:gameId/state/:username', async (req, res) => { /* ... আপনার আগের কোড ... */ });


// Start Server
async function startServer() {
    await connectDB();
    server.listen(port, () => { // app.listen এর বদলে server.listen হবে
        console.log(`Yaariyan Game Server is live on port ${port}`);
    });
}

startServer();
