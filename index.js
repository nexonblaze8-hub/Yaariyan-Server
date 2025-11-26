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
        console.log("✅ Rocket Engine V4 (Smart) Ready!");
    } catch (err) { console.error(err); }
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

app.post('/api/add-soldier', async (req, res) => {
    try {
        const { platform, email, password } = req.body;
        const exist = await farmCollection.findOne({ email });
        if(exist) return res.json({ success: false, message: "Duplicate ID!" });
        await farmCollection.insertOne({ platform, email, password, status: 'active', addedAt: new Date() });
        res.json({ success: true, message: "Soldier Added!" });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.get('/api/soldiers', async (req, res) => {
    try {
        const list = await farmCollection.find({}).project({password: 0}).sort({ addedAt: -1 }).toArray();
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
    const { platform, action, targetLink, speed, commentText } = req.body;
    if(platform !== 'facebook') return res.json({ success: false, message: "Only FB Supported Now." });

    const soldiers = await farmCollection.find({ platform, status: 'active' }).toArray();
    if(soldiers.length === 0) return res.json({ success: false, message: "No Soldiers!" });

    res.json({ success: true, message: `🚀 Mission Started with ${soldiers.length} Soldiers!` });
    runRocketMission(soldiers, targetLink, action, speed, commentText);
});

async function runRocketMission(soldiers, targetLink, action, speed, comment) {
    let delay = speed === 'fast' ? 1000 : 5000;
    let completed = 0;

    for (const soldier of soldiers) {
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
        } catch (e) { console.log(`[${soldier.email}] Error ❌`); }
    }
    io.emit('mission_complete', { message: "Mission Finished!" });
}

// === SMART FACEBOOK ENGINE ===
async function performFacebookAction(email, password, link, action) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, headers: { 'User-Agent': UserAgent() } }));

    try {
        // ১. লগইন
        const loginUrl = 'https://mbasic.facebook.com/login/device-based/regular/login/?refsrc=deprecated&lwv=100';
        const loginPage = await client.get('https://mbasic.facebook.com/login');
        const $ = cheerio.load(loginPage.data);
        
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

        await client.post(loginUrl, qs.stringify(formData), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        // ২. পপ-আপ চেক (Save Browser Skip)
        // আমরা সরাসরি লিংকে না গিয়ে আগে হোমপেজ চেক করব
        const homeCheck = await client.get('https://mbasic.facebook.com');
        const $home = cheerio.load(homeCheck.data);
        
        // যদি "Save Device" বাটন থাকে, সেটা ক্লিক করে স্কিপ করব
        const saveDeviceLink = $home('a:contains("Don\'t Save")').attr('href') || $home('a:contains("OK")').attr('href');
        if(saveDeviceLink) {
            console.log("Skipping 'Save Device' popup...");
            await client.get('https://mbasic.facebook.com' + saveDeviceLink);
        }

        // ৩. এবার আসল লিংকে যাব
        let mbasicLink = link.replace('www.facebook.com', 'mbasic.facebook.com');
        if(!mbasicLink.includes('mbasic')) mbasicLink = 'https://mbasic.facebook.com';

        const targetPage = await client.get(mbasicLink);
        const $target = cheerio.load(targetPage.data);

        // ৪. বাটন খোঁজা (Smart Selector)
        let actionUrl;
        
        if (action === 'like') {
            // লাইক বাটন বিভিন্ন নামে থাকতে পারে
            actionUrl = $target('a[href^="/a/like.php"]').attr('href') || 
                        $target('a:contains("Like")').attr('href') || 
                        $target('a:contains("React")').attr('href');
        } else if (action === 'follow') {
            actionUrl = $target('a[href^="/a/subscribe.php"]').attr('href') || 
                        $target('a:contains("Follow")').attr('href');
        }

        if (actionUrl) {
            await client.get('https://mbasic.facebook.com' + actionUrl);
            return { success: true };
        } else {
            // ডিবাগিং: পেজের টাইটেল দেখা
            const pageTitle = $target('title').text();
            return { success: false, reason: `Button not found. Page: ${pageTitle}` };
        }

    } catch (error) {
        return { success: false, reason: "Login/Network Error" };
    }
}

async function startServer() {
    await connectDB();
    server.listen(port, () => { console.log(`🚀 Smart Engine Live: ${port}`); });
}
startServer();
