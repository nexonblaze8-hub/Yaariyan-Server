const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const uri = process.env.MONGO_URI;
if (!uri) { console.error("MONGO_URI Missing!"); process.exit(1); }
const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, farmCollection;

// Pixel 7 Headers (For Requests)
const HEADERS = {
    'User-Agent': "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36",
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Upgrade-Insecure-Requests': '1'
};

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        farmCollection = db.collection("farming_soldiers");
        console.log("✅ Cookie Engine Ready!");
    } catch (err) { console.error(err); }
}

io.on('connection', (socket) => {
    socket.on('get_stats', async () => {
        if(farmCollection) {
            const fb = await farmCollection.countDocuments({ platform: 'facebook' });
            socket.emit('stats_update', { fb, insta: 0, yt: 0 });
        }
    });
});

// 1. Add Soldier (Now takes COOKIE instead of Password)
app.post('/api/add-soldier', async (req, res) => {
    try {
        const { platform, email, password } = req.body; 
        // Note: Here 'password' field will be used to store 'COOKIE' from frontend
        
        await farmCollection.insertOne({ 
            platform, 
            email, 
            cookie: password, // We save the password input as cookie
            status: 'active', 
            addedAt: new Date() 
        });
        res.json({ success: true, message: "Soldier Added via Cookie!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/soldiers', async (req, res) => {
    try {
        const list = await farmCollection.find({}).project({cookie: 0}).sort({ addedAt: -1 }).toArray();
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/delete-soldier', async (req, res) => {
    try {
        const { id } = req.body;
        await farmCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: "Deleted!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/api/start-mission', async (req, res) => {
    const { platform, action, targetLink, speed } = req.body;
    
    const soldiers = await farmCollection.find({ platform, status: 'active' }).toArray();
    if(soldiers.length === 0) return res.json({ success: false, message: "No Soldiers!" });

    res.json({ success: true, message: `🚀 Cookie Mission Started!` });
    runCookieMission(soldiers, targetLink, action, speed);
});

async function runCookieMission(soldiers, targetLink, action, speed) {
    let delay = speed === 'fast' ? 1000 : 4000;

    for (const soldier of soldiers) {
        await new Promise(r => setTimeout(r, delay));
        try {
            const status = await performActionWithCookie(soldier.cookie, targetLink, action);
            
            let logMsg = status.success ? `[${soldier.email}] Success ✅` : `[${soldier.email}] Failed ❌`;
            console.log(logMsg);
            
            io.emit('mission_progress', { platform: 'facebook', log: logMsg, completed: 1, total: soldiers.length });

        } catch (e) { console.log(`Error`); }
    }
    io.emit('mission_complete', { message: "Mission Finished!" });
}

async function performActionWithCookie(cookieString, link, action) {
    try {
        // ১. কুকি সেট করা
        const instance = axios.create({
            headers: { ...HEADERS, 'Cookie': cookieString }
        });

        // ২. টার্গেট পেজে যাওয়া (mbasic)
        let mbasicLink = link.replace('www.facebook.com', 'mbasic.facebook.com');
        if(!mbasicLink.includes('mbasic')) mbasicLink = 'https://mbasic.facebook.com';

        const targetPage = await instance.get(mbasicLink);
        const $ = cheerio.load(targetPage.data);

        // ৩. বাটন খোঁজা এবং ক্লিক করা
        let actionUrl;
        if (action === 'like') {
            actionUrl = $('a[href^="/a/like.php"]').attr('href') || $('a:contains("Like")').attr('href');
        } else if (action === 'follow') {
            actionUrl = $('a[href^="/a/subscribe.php"]').attr('href') || $('a:contains("Follow")').attr('href');
        }

        if (actionUrl) {
            await instance.get('https://mbasic.facebook.com' + actionUrl);
            return { success: true };
        } else {
            return { success: false, reason: "Button Not Found" };
        }

    } catch (error) {
        return { success: false, reason: "Network/Cookie Expired" };
    }
}

async function startServer() {
    await connectDB();
    server.listen(port, () => { console.log(`🚀 Cookie Engine Live: ${port}`); });
}
startServer();
