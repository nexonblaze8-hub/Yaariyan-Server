const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- ১. কনফিগারেশন (তোমার দেওয়া চাবিগুলো বসানো হলো) ---

// তোমার MongoDB ডাটাবেস লিংক
const uri = "mongodb+srv://nexonblaze8_db_user:5R9kKxC6oFXQrX7V@cluster0.ctfgfd4.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// তোমার Google Gemini API Key
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
        const db = client.db("SuperAIDB"); // ডাটাবেসের নাম
        aiCollection = db.collection("knowledge"); // কালেকশন
        console.log("🔥 Database Connected! MongoDB is Ready.");
    } catch (err) {
        console.error("Database Error:", err);
    }
}
connectDB();

// --- ২. মেইন রুট (সার্ভার চেক করার জন্য) ---
app.get('/', (req, res) => res.send('AI Server is Running perfectly! 🚀'));

// --- ৩. চ্যাট এবং শেখার লজিক ---
app.post('/chat', async (req, res) => {
    const userMessage = req.body.message;
    if (!userMessage) return res.status(400).json({ reply: "কিছু লিখুন..." });

    try {
        // ধাপ ১: মেমোরি চেক (MongoDB) - আগের শেখা উত্তর খুঁজছে
        const memory = await aiCollection.findOne({ 
            question: { $regex: new RegExp(`^${userMessage}$`, 'i') } 
        });

        if (memory) {
            console.log("💡 Found in Memory!");
            return res.json({ reply: memory.answer, source: "Memory (স্মৃতি)" });
        }

        // ধাপ ২: মেমোরিতে না থাকলে ইন্টারনেট (Gemini AI) থেকে জানা
        console.log("🌐 Asking Gemini AI...");
        
        // AI-কে নির্দেশ দেওয়া হচ্ছে যেন সে একই ভাষায় ছোট করে উত্তর দেয়
        const prompt = `Answer the following question concisely and clearly in the SAME LANGUAGE (Bengali or English) as the user asked. Question: ${userMessage}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiReply = response.text();

        // ধাপ ৩: নতুন জ্ঞান ডাটাবেসে সেভ করা (ভবিষ্যতের জন্য)
        if (aiReply) {
            await aiCollection.insertOne({
                question: userMessage,
                answer: aiReply,
                learnedAt: new Date()
            });
            console.log("✅ New knowledge saved to MongoDB!");
        }

        res.json({ reply: aiReply, source: "Internet (শিখে নিলাম)" });

    } catch (error) {
        console.error("Error:", error);
        res.json({ reply: "সার্ভারে একটু সমস্যা হচ্ছে, আবার চেষ্টা করুন।", source: "Error" });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
