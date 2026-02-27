const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- ১. ডাইরেক্ট চাবি বসানো হলো (টেস্ট করার জন্য) ---

const uri = "mongodb+srv://nexonblaze8_db_user:5R9kKxC6oFXQrX7V@cluster0.ctfgfd4.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const GEN_AI_KEY = "AIzaSyAwxEa-AHkI1maYv2FWexYbdZow_Cw1glY";

// AI সেটআপ
const genAI = new GoogleGenerativeAI(GEN_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro"});

// MongoDB সেটআপ
const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let aiCollection;

async function connectDB() {
    try {
        await client.connect();
        const db = client.db("SuperAIDB");
        aiCollection = db.collection("knowledge");
        console.log("🔥 Database Connected!");
    } catch (err) {
        console.error("Database Error:", err);
    }
}
connectDB();

app.get('/', (req, res) => res.send('AI Server Ready with Direct Keys! 🚀'));

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ reply: "কিছু লিখুন..." });

    try {
        // ১. মেমোরি চেক
        if (aiCollection) {
            const memory = await aiCollection.findOne({ 
                question: { $regex: new RegExp(`^${userMessage}$`, 'i') } 
            });

            if (memory) {
                return res.json({ reply: memory.answer, source: "Memory (স্মৃতি)" });
            }
        }

        // ২. ইন্টারনেট থেকে জানা
        const prompt = `Answer in Bengali or English concisely: ${userMessage}`;
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiReply = response.text();

        // ৩. সেভ করা
        if (aiReply && aiCollection) {
            await aiCollection.insertOne({
                question: userMessage,
                answer: aiReply,
                learnedAt: new Date()
            });
        }

        res.json({ reply: aiReply, source: "Internet (শিখে নিলাম)" });

    } catch (error) {
        console.error("Error:", error);
        res.json({ reply: "সার্ভারে সমস্যা হচ্ছে।", source: "Error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
