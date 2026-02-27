const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- ১. সিকিউরিটি টিপ: এই কীগুলো .env ফাইলে রাখা উচিত ---
const uri = "mongodb+srv://nexonblaze8_db_user:5R9kKxC6oFXQrX7V@cluster0.ctfgfd4.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const GEN_AI_KEY = "AIzaSyAwxEa-AHkI1maYv2FWexYbdZow_Cw1glY"; // আপনার কী

// AI সেটআপ (Gemini 1.5 Flash ব্যবহার করা হয়েছে যা দ্রুত)
const genAI = new GoogleGenerativeAI(GEN_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
        console.error("❌ Database Error:", err);
    }
}
connectDB();

app.get('/', (req, res) => res.send('AI Server is Online! 🚀'));

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ reply: "কিছু লিখুন..." });

    try {
        // ১. মেমোরি চেক (আগে শেখা আছে কিনা)
        let existingMemory = null;
        if (aiCollection) {
            existingMemory = await aiCollection.findOne({ 
                question: { $regex: new RegExp(`^${userMessage.trim()}$`, 'i') } 
            });
        }

        if (existingMemory) {
            return res.json({ reply: existingMemory.answer, source: "স্মৃতি (Memory)" });
        }

        // ২. ইন্টারনেট বা AI থেকে জেনারেট করা
        const prompt = `You are a helpful AI assistant. Answer the user concisely. User says: ${userMessage}`;
        const result = await model.generateContent(prompt);
        const aiReply = result.response.text();

        // ৩. নতুন তথ্য ডাটাবেসে সেভ করা (ভবিষ্যতের জন্য)
        if (aiReply && aiCollection) {
            await aiCollection.insertOne({
                question: userMessage.trim(),
                answer: aiReply,
                learnedAt: new Date()
            });
        }

        res.json({ reply: aiReply, source: "ইন্টারনেট (Learned)" });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({ reply: "দুঃখিত, আমি এই মুহূর্তে উত্তর দিতে পারছি না।", source: "Error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
