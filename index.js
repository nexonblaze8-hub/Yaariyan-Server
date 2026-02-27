const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 🔒 এখানে আমরা সরাসরি চাবি না বসিয়ে সার্ভারের মেমোরি থেকে নিচ্ছি
const uri = process.env.MONGO_URI; 
const GEN_AI_KEY = process.env.GEN_AI_KEY;

const genAI = new GoogleGenerativeAI(GEN_AI_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const client = new MongoClient(uri, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let aiCollection;

async function connectDB() {
    try {
        if (!uri) throw new Error("MONGO_URI পাওয়া যায়নি!");
        await client.connect();
        aiCollection = client.db("SuperAIDB").collection("knowledge");
        console.log("✅ ডাটাবেস নিরাপদভাবে কানেক্ট হয়েছে!");
    } catch (err) {
        console.error("❌ এরর:", err.message);
    }
}
connectDB();

app.get('/', (req, res) => res.send('AI Server is Running Securely! 🛡️'));

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ reply: "কিছু লিখুন..." });

    try {
        if (aiCollection) {
            const memory = await aiCollection.findOne({ question: { $regex: new RegExp(`^${userMessage}$`, 'i') } });
            if (memory) return res.json({ reply: memory.answer, source: "স্মৃতি" });
        }

        const result = await model.generateContent(userMessage);
        const aiReply = result.response.text();

        if (aiCollection) {
            await aiCollection.insertOne({ question: userMessage, answer: aiReply, date: new Date() });
        }
        res.json({ reply: aiReply, source: "AI" });
    } catch (error) {
        res.status(500).json({ reply: "সার্ভারে সমস্যা, চাবিগুলো ঠিক আছে তো?", error: error.message });
    }
});

app.listen(port, () => console.log(`Server on port ${port}`));
