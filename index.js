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

// === MOBILE HEADERS (ছদ্মবেশ) ===
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36";
const HEADERS = {
    'User-Agent': MOBILE_UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1'
};

async function connectDB() {
    try {
        await client.connect();
        db = client.db("YaariyanGameDB");
        farmCollection = db.collection("farming_soldiers");
        console.log("✅ Stealth Engine V5 Ready!");
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

app.post('/api/add-soldier', async (req, res) => {
    try {
        const { platform, email, password } = req.body;
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
    const { platform, action, targetLink, speed } = req.body;
    if(platform !== 'facebook') return res.json({ success: false, message: "Only FB Supported." });

    const soldiers = await farmCollection.find({ platform, status: 'active' }).toArray();
    if(soldiers.length === 0) return res.json({ success: false, message: "No Soldiers!" });

    res.json({ success: true, message: `🚀 Stealth Mission Started!` });
    runRocketMission(soldiers, targetLink, action, speed);
});

async function runRocketMission(soldiers, targetLink, action, speed) {
    let delay = speed === 'fast' ? 2000 : 5000;

    for (const soldier of soldiers) {
        await new Promise(r => setTimeout(r, delay));
        try {
            const status = await performFacebookAction(soldier.email, soldier.password, targetLink, action);
            
            let logMsg = "";
            if(status.success) {
                logMsg = `[${soldier.email}] ${action} Success ✅`;
            } else {
                logMsg = `[${soldier.email}] Failed: ${status.reason} ❌`;
            }
            
            console.log(logMsg);
            io.emit('mission_progress', { platform: 'facebook', log: logMsg, completed: 1, total: soldiers.length });

        } catch (e) { console.log(`Error`); }
    }
    io.emit('mission_complete', { message: "Mission Finished!" });
}

async function performFacebookAction(email, password, link, action) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, headers: HEADERS }));

    try {
        // 1. Login Page Load
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

        // 2. Submit Login
        await client.post(loginUrl, qs.stringify(formData), {
            headers: { 
                ...HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://mbasic.facebook.com/login'
            }
        });

        // 3. Check if login worked (by checking home)
        const homeCheck = await client.get('https://mbasic.facebook.com');
        if (homeCheck.data.includes('Log In')) {
            return { success: false, reason: "Wrong Password or 2FA Required" };
        }

        // 4. Go to Target
        let mbasicLink = link.replace('www.facebook.com', 'mbasic.facebook.com');
        if(!mbasicLink.includes('mbasic')) mbasicLink = 'https://mbasic.facebook.com';

        const targetPage = await client.get(mbasicLink);
        const $target = cheerio.load(targetPage.data);

        // 5. Find Button
        let actionUrl;
        if (action === 'like') {
            actionUrl = $target('a[href^="/a/like.php"]').attr('href') || $target('a:contains("Like")').attr('href');
        } else if (action === 'follow') {
            actionUrl = $target('a[href^="/a/subscribe.php"]').attr('href') || $target('a:contains("Follow")').attr('href');
        }

        if (actionUrl) {
            await client.get('https://mbasic.facebook.com' + actionUrl);
            return { success: true };
        } else {
            return { success: false, reason: "Button Not Found (Already Liked?)" };
        }

    } catch (error) {
        return { success: false, reason: "Network Error" };
    }
}

async function startServer() {
    await connectDB();
    server.listen(port, () => { console.log(`🚀 Stealth Engine Live: ${port}`); });
}
startServer();
