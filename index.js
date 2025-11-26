const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// Socket.io Setup
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const uri = process.env.MONGO_URI;
if (!uri) { console.error("MONGO_URI Missing!"); process.exit(1); }

const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, farmCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        farmCollection = db.collection("farming_soldiers");
        console.log("✅ Farming Engine V3 Ready!");
    } catch (err) { process.exit(1); }
}

io.on('connection', (socket) => {
    socket.on('get_stats', async () => {
        if(farmCollection) {
            const fb = await farmCollection.countDocuments({ platform: 'facebook' });
            const insta = await farmCollection.countDocuments({ platform: 'instagram' });
            const yt = await farmCollection.countDocuments({ platform: 'youtube' });
            socket.emit('stats_update', { fb, insta, yt });
        }
    });
});

// === API ROUTES ===

// ১. আইডি অ্যাড করা
app.post('/api/add-soldier', async (req, res) => {
    try {
        const { platform, email, password } = req.body;
        const exist = await farmCollection.findOne({ email });
        if(exist) return res.json({ success: false, message: "Duplicate ID!" });

        await farmCollection.insertOne({ platform, email, password, status: 'active', addedAt: new Date() });
        
        // লাইভ আপডেট
        const count = await farmCollection.countDocuments({ platform });
        io.emit('stats_update_single', { platform, count });
        res.json({ success: true, message: "Saved Successfully!" });
    } catch (e) { res.status(500).json({ success: false, message: "Error" }); }
});

// ২. সব সোলজারের লিস্ট পাঠানো (ডানদিকের স্লাইডারের জন্য)
app.get('/api/soldiers', async (req, res) => {
    try {
        const list = await farmCollection.find({}).project({password: 0}).sort({ addedAt: -1 }).toArray();
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ৩. সোলজার ডিলিট করা
app.post('/api/delete-soldier', async (req, res) => {
    try {
        const { id } = req.body;
        await farmCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: "Deleted!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ৪. মিশন স্টার্ট (আপগ্রেডেড ইঞ্জিন)
app.post('/api/start-mission', async (req, res) => {
    const { platform, action, targetLink, speed, commentText } = req.body;
    
    const soldiers = await farmCollection.find({ platform, status: 'active' }).toArray();
    if(soldiers.length === 0) return res.json({ success: false, message: "No Soldiers Found!" });

    res.json({ success: true, message: `Mission Started with ${soldiers.length} Soldiers!` });

    runMissionEngine(soldiers, targetLink, action, speed, commentText);
});

async function runMissionEngine(soldiers, link, action, speed, comment) {
    // স্পিড লজিক
    let delay = 3000; // Normal
    if(speed === 'slow') delay = 6000;
    if(speed === 'fast') delay = 1000;

    let completed = 0;

    for (const soldier of soldiers) {
        await new Promise(r => setTimeout(r, delay));

        try {
            // সিমুলেশন লগ
            let logMsg = `[${soldier.email}] ${action} Success ✅`;
            if(action === 'comment') logMsg = `[${soldier.email}] Commented: "${comment}" ✅`;

            console.log(logMsg);
            completed++;

            io.emit('mission_progress', { 
                platform: soldier.platform,
                log: logMsg, // লাইভ লগ পাঠানো হচ্ছে
                completed, 
                total: soldiers.length 
            });

        } catch (e) {
            console.log(`[${soldier.email}] Failed ❌`);
        }
    }
    io.emit('mission_complete', { message: "Mission Finished! 🎉" });
}

async function startServer() {
    await connectDB();
    server.listen(port, () => { console.log(`Server Live: ${port}`); });
}
startServer();
