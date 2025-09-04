// নতুন API endpoints যোগ করুন
app.get('/khata/today/:username', async (req, res) => {
  const { username } = req.params;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  try {
    const transactions = await transactionsCollection.find({
      $or: [{ fromUser: username }, { toUser: username }],
      date: { $gte: today }
    }).toArray();

    let total = 0;
    transactions.forEach(t => {
      if (t.fromUser === username) total -= t.amount;
      else total += t.amount;
    });

    res.status(200).json({
      total: Math.abs(total),
      perPerson: transactions.length > 0 ? Math.abs(total) / transactions.length : 0,
      balance: total
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching today's summary" });
  }
});

app.get('/profile/stats/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const user = await usersCollection.findOne({ username });
    if (user) {
      res.status(200).json({
        totalGames: user.stats.gamesPlayed,
        wins: user.stats.wins,
        winRate: user.stats.winRatio,
        rank: user.stats.rank || 0
      });
    } else {
      res.status(404).json({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile stats" });
  }
});

// Socket.IO group chat handler
io.on('connection', (socket) => {
  // আগের existing code...

  socket.on('send_group_message', async (data) => {
    const groupMessage = {
      fromUser: data.fromUser,
      group: data.group,
      message: data.message,
      timestamp: new Date()
    };
    await chatsCollection.insertOne(groupMessage);
    io.emit('receive_group_message', groupMessage);
  });
});

app.get('/game-types', (req, res) => {
  res.status(200).json([
    "Hazzari",
    "Call Break", 
    "29",
    "Joker"
  ]);
});
