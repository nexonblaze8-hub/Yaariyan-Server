const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const UserAgent = require('fake-useragent');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Socket.io
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

// Database Setup
const uri = process.env.MONGO_URI;
if (!uri) { console.error("MONGO_URI Missing!"); process.exit(1); }
const client = new MongoClient(uri, { serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true } });

let db, farmCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        farmCollection = db.collection("farming_soldiers");
        console.log("✅ Rocket Engine V3 Ready!");
    } catch (err) { console.error(err); }
}

// === SOCKET ===
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
        const count = await farmCollection.countDocuments({ platform });
        io.emit('stats_update_single', { platform, count });
        res.json({ success: true, message: "Soldier Added!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ২. লিস্ট দেখা
app.get('/api/soldiers', async (req, res) => {
    try {
        const list = await farmCollection.find({}).project({password: 0}).sort({ addedAt: -1 }).toArray();
        res.json({ success: true, list });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ৩. ডিলিট করা
app.post('/api/delete-soldier', async (req, res) => {
    try {
        const { id } = req.body;
        await farmCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true, message: "Deleted!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

// ৪. মিশন স্টার্ট (High Speed Logic)
app.post('/api/start-mission', async (req, res) => {
    const { platform, action, targetLink, speed, commentText } = req.body;
    
    // শুধু ফেসবুকের জন্য রকেট মেথড (আপাতত)
    if(platform !== 'facebook') {
        return res.json({ success: false, message: "আপাতত শুধু Facebook ফাস্ট মোডে কাজ করবে।" });
    }

    const soldiers = await farmCollection.find({ platform, status: 'active' }).toArray();
    if(soldiers.length === 0) return res.json({ success: false, message: "No Soldiers!" });

    res.json({ success: true, message: `🚀 Rocket Mission Started with ${soldiers.length} Soldiers!` });

    // ব্যাকগ্রাউন্ডে রান করা
    runRocketMission(soldiers, targetLink, action, speed, commentText);
});

// === ROCKET ENGINE (The Magic) ===
async function runRocketMission(soldiers, targetLink, action, speed, comment) {
    let delay = speed === 'fast' ? 1000 : 5000; // ফাস্ট হলে ১ সেকেন্ড ডিলে

    let completed = 0;

    for (const soldier of soldiers) {
        // ১. প্রতিটি আইডির মাঝে ডিলে (ব্যান ঠেকাতে)
        await new Promise(r => setTimeout(r, delay));

        try {
            const status = await performFacebookAction(soldier.email, soldier.password, targetLink, action);
            
            if(status.success) {
                completed++;
                const logMsg = `[${soldier.email}] ${action} Success ✅`;
                console.log(logMsg);
                io.emit('mission_progress', { platform: 'facebook', log: logMsg, completed, total: soldiers.length });
            } else {
                const logMsg = `[${soldier.email}] Failed: ${status.reason} ❌`;
                console.log(logMsg);
                io.emit('mission_progress', { platform: 'facebook', log: logMsg, completed, total: soldiers.length });
            }

        } catch (e) {
            console.log(`[${soldier.email}] Error ❌`);
        }
    }
    io.emit('mission_complete', { message: "Mission Finished! 🎉" });
}

// === FACEBOOK LOGIC (mBasic Scraper) ===
async function performFacebookAction(email, password, link, action) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, headers: { 'User-Agent': UserAgent() } }));

    try {
        // ১. লগইন পেজে যাওয়া (টোকেন নেওয়ার জন্য)
        console.log(`Trying login for ${email}...`);
        const loginPage = await client.get('https://mbasic.facebook.com/login');
        const $ = cheerio.load(loginPage.data);
        
        const loginUrl = 'https://mbasic.facebook.com/login/device-based/regular/login/?refsrc=deprecated&lwv=100';
        const formData = {
            email: email,
            pass: password,
            lsd: $('input[name="lsd"]').val(),
            jazoest: $('input[name="jazoest"]').val(),
            m_ts: $('input[name="m_ts"]').val(),
            li: $('input[name="li"]').val(),
            try_number: 0,
            unrecognized_tries: 0,
            login: 'Log In'
        };

        // ২. লগইন সাবমিট করা
        await client.post(loginUrl, qs.stringify(formData), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // ৩. টার্গেট লিংকে যাওয়া
        // (mbasic লিংক কনভার্ট করা)
        let mbasicLink = link.replace('www.facebook.com', 'mbasic.facebook.com');
        if(!mbasicLink.includes('mbasic')) mbasicLink = 'https://mbasic.facebook.com';

        const targetPage = await client.get(mbasicLink);
        const $target = cheerio.load(targetPage.data);

        // ৪. অ্যাকশন নেওয়া (Like / Follow)
        let actionUrl;

        if (action === 'like') {
            // "Like" বাটন খোঁজা
            actionUrl = $target('a:contains("Like")').attr('href') || $target('a:contains("React")').attr('href');
        } else if (action === 'follow') {
            actionUrl = $target('a:contains("Follow")').attr('href');
        } else if (action === 'friend') {
            actionUrl = $target('a:contains("Add Friend")').attr('href');
        }

        if (actionUrl) {
            await client.get('https://mbasic.facebook.com' + actionUrl);
            return { success: true };
        } else {
            return { success: false, reason: "Button not found or Already Liked" };
        }

    } catch (error) {
        return { success: false, reason: "Login/Network Error" };
    }
}

async function startServer() {
    await connectDB();
    server.listen(port, () => { console.log(`🚀 Rocket Engine Live: ${port}`); });
}
startServer();
