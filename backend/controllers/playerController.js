const { connectDB } = require('../config/database');
const { uploadImageBuffer, destroyImage } = require('../utils/cloudinary');
const { ObjectId } = require('mongodb');
const path = require('path');
const bcrypt = require('bcryptjs');
const Player = require('../models/Player');
const Team = require('../models/Team');
const { swissPairing, swissTeamPairing } = require('../utils/swissPairing');
let multer;
try { multer = require('multer'); } catch (e) { multer = null; }

const BCRYPT_ROUNDS = 12;
const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$/.test(value);
const verifyPasswordAndMaybeMigrate = async (db, user, plainPassword) => {
  const stored = user?.password;
  if (!stored || typeof stored !== 'string') return false;
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) return false;
  if (isBcryptHash(stored)) {
    return bcrypt.compare(plainPassword, stored);
  }
  if (stored === plainPassword) {
    const hashed = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    await db.collection('users').updateOne({ _id: user._id }, { $set: { password: hashed } });
    return true;
  }
  return false;
};

// 1. GET /api/dashboard
const getDashboard = async (req, res) => {
  if (!req.session.username) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const db = await connectDB();
  const username = req.session.username;
  const user = await db.collection('users').findOne({ name: username, role: 'player', isDeleted: 0 });
  if (!user) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const latestTournaments = await db.collection('tournaments')
    .find({ status: 'Approved' })
    .sort({ date: -1 })
    .limit(5)
    .toArray();

  const latestItems = await db.collection('products')
    .find({ availability: { $gt: 0 } })
    .sort({ _id: -1 })
    .limit(5)
    .toArray();

  const teamRequests = await db.collection('enrolledtournaments_team').aggregate([
    {
      $match: {
        $or: [{ player1_name: username }, { player2_name: username }, { player3_name: username }],
        approved: 0
      }
    },
    { $lookup: { from: 'tournaments', localField: 'tournament_id', foreignField: '_id', as: 'tournament' } },
    { $unwind: '$tournament' },
    { $lookup: { from: 'users', localField: 'captain_id', foreignField: '_id', as: 'captain' } },
    { $unwind: '$captain' },
    {
      $project: {
        id: '$_id',
        tournamentName: '$tournament.name',
        captainName: '$captain.name',
        player1_name: 1,
        player2_name: 1,
        player3_name: 1,
        player1_approved: 1,
        player2_approved: 1,
        player3_approved: 1
      }
    }
  ]).toArray();

  res.json({
    playerName: username,
    latestTournaments: latestTournaments || [],
    latestItems: latestItems || [],
    teamRequests: teamRequests || []
  });
};

// 2. GET /api/tournaments
const getTournaments = async (req, res) => {
  if (!req.session.username) {
    console.log('No username in session');
    return res.status(401).json({ error: 'Please log in' });
  }

  try {
    const db = await connectDB();
    console.log('Connected to database');
    const username = req.session.username;
    console.log('Session username:', username);

    const user = await db.collection('users').findOne({ name: username, role: 'player', isDeleted: 0 });
    if (!user) {
      console.log('User not found for username:', username);
      return res.status(404).json({ error: 'Player not found' });
    }
    console.log('User found:', user);

    const balance = await db.collection('user_balances').findOne({ user_id: user._id });
    const walletBalance = balance?.wallet_balance || 0;
    console.log('Wallet balance:', walletBalance);

    const tournamentsRaw = await db.collection('tournaments').find({ status: 'Approved' }).toArray();
    const tournaments = (tournamentsRaw || []).map(t => ({ ...t, _id: t._id.toString() }));
    console.log('Fetched tournaments:', tournaments);

    const enrolledIndividualTournamentsRaw = await db.collection('tournament_players').aggregate([
      { $match: { username } },
      { $lookup: { from: 'tournaments', localField: 'tournament_id', foreignField: '_id', as: 'tournament' } },
      { $unwind: '$tournament' },
      { $project: { tournament: 1 } }
    ]).toArray();
    const enrolledIndividualTournaments = (enrolledIndividualTournamentsRaw || []).map(e => ({
      ...e,
      tournament: e.tournament ? { ...e.tournament, _id: e.tournament._id.toString() } : null
    }));
    console.log('Enrolled individual tournaments:', enrolledIndividualTournaments);

    const enrolledTeamTournamentsRaw = await db.collection('enrolledtournaments_team').aggregate([
      {
        $match: {
          $or: [{ captain_id: user._id }, { player1_name: username }, { player2_name: username }, { player3_name: username }]
        }
      },
      { $lookup: { from: 'tournaments', localField: 'tournament_id', foreignField: '_id', as: 'tournament' } },
      { $lookup: { from: 'users', localField: 'captain_id', foreignField: '_id', as: 'captain' } },
      { $unwind: '$tournament' },
      { $unwind: '$captain' },
      {
        $project: {
          _id: 1,
          tournament_id: '$tournament_id',
          tournament: '$tournament',
          captainName: '$captain.name',
          player1_name: 1,
          player2_name: 1,
          player3_name: 1,
          player1_approved: 1,
          player2_approved: 1,
          player3_approved: 1,
          approved: 1,
          enrollment_date: 1
        }
      }
    ]).toArray();
    const enrolledTeamTournaments = (enrolledTeamTournamentsRaw || []).map(e => ({
      ...e,
      _id: e._id ? e._id.toString() : undefined,
      tournament: e.tournament ? { ...e.tournament, _id: e.tournament._id.toString() } : null
    }));
    console.log('Enrolled team tournaments:', enrolledTeamTournaments);

    const subscription = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
    console.log('Subscription:', subscription);

    const response = {
      tournaments: tournaments || [],
      enrolledIndividualTournaments: enrolledIndividualTournaments || [],
      enrolledTeamTournaments: enrolledTeamTournaments || [],
      username,
      walletBalance,
      currentSubscription: subscription || null
    };
    console.log('API response:', response);
    res.json(response);
  } catch (err) {
    console.error('Error in /api/tournaments:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 3. POST /api/join-individual
const joinIndividual = async (req, res) => {
  if (!req.session.username || !req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const { tournamentId } = req.body || {};
  if (!tournamentId) return res.status(400).json({ error: 'Tournament ID is required' });
  if (!ObjectId.isValid(tournamentId)) return res.status(400).json({ error: 'Invalid tournament ID' });

  try {
    const db = await connectDB();
    const username = req.session.username;
    const user = await db.collection('users').findOne({ name: username, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    // Ensure tournament exists and is approved
    const tournament = await db.collection('tournaments').findOne({ _id: new ObjectId(tournamentId), status: 'Approved' });
    if (!tournament) return res.status(404).json({ error: 'Tournament not found or not approved' });
    if ((tournament.type || '').toLowerCase() !== 'individual') {
      return res.status(400).json({ error: 'This is not an individual tournament' });
    }

    // Subscription must be active
    const subscription = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
    if (!subscription || (subscription.end_date && new Date(subscription.end_date) <= new Date())) {
      return res.status(400).json({ error: 'Subscription required' });
    }

    // Already enrolled?
    const already = await db.collection('tournament_players').findOne({ tournament_id: new ObjectId(tournamentId), username });
    if (already) return res.status(400).json({ error: 'Already enrolled' });

    // Wallet check
    const balDoc = await db.collection('user_balances').findOne({ user_id: user._id });
    const walletBalance = balDoc?.wallet_balance || 0;
    const fee = parseFloat(tournament.entry_fee) || 0;
    if (walletBalance < fee) return res.status(400).json({ error: 'Insufficient wallet balance' });

    // Deduct and enroll
    await db.collection('user_balances').updateOne(
      { user_id: user._id },
      { $inc: { wallet_balance: -fee } },
      { upsert: true }
    );

    await db.collection('tournament_players').insertOne({
      tournament_id: new ObjectId(tournamentId),
      username,
      college: user.college || '',
      gender: user.gender || ''
    });

    const newBal = await db.collection('user_balances').findOne({ user_id: user._id });
    res.json({ success: true, message: 'Joined successfully', walletBalance: newBal?.wallet_balance || (walletBalance - fee) });
  } catch (err) {
    console.error('Error in /api/join-individual:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 4. POST /api/join-team
const joinTeam = async (req, res) => {
  if (!req.session.username || !req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }

  const { tournamentId, player1, player2, player3 } = req.body;
  console.log('join-team request:', { tournamentId, player1, player2, player3, captain: req.session.username });

  if (!tournamentId || !player1 || !player2 || !player3) {
    return res.status(400).json({ error: 'Tournament ID and three player usernames are required' });
  }

  // Trim whitespace from player names
  const p1 = (player1 || '').trim();
  const p2 = (player2 || '').trim();
  const p3 = (player3 || '').trim();

  if (!p1 || !p2 || !p3) {
    return res.status(400).json({ error: 'All three player usernames are required' });
  }

  // Check all players are distinct
  const uniquePlayers = new Set([p1, p2, p3]);
  if (uniquePlayers.size !== 3) {
    return res.status(400).json({ error: 'All three players must be different' });
  }

  try {
    const db = await connectDB();
    const username = req.session.username;
    const user = await db.collection('users').findOne({ name: username, role: 'player', isDeleted: 0 });
    if (!user) {
      return res.status(404).json({ error: 'Your player account not found' });
    }

    // Captain must be one of the 3 players
    if (![p1, p2, p3].includes(username)) {
      return res.status(400).json({ error: 'You (the captain) must be one of the three team members' });
    }

    if (!ObjectId.isValid(tournamentId)) {
      return res.status(400).json({ error: 'Invalid tournament ID' });
    }

    const tournament = await db.collection('tournaments').findOne({ _id: new ObjectId(tournamentId), status: 'Approved' });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found or not approved' });
    }

    // Check tournament is team type
    const tournamentType = (tournament.type || '').toLowerCase();
    if (!['team', 'group'].includes(tournamentType)) {
      return res.status(400).json({ error: 'This is not a team tournament' });
    }

    // Verify all players exist - find by name (username)
    const players = await db.collection('users').find({
      name: { $in: [p1, p2, p3] },
      role: 'player',
      isDeleted: 0
    }).toArray();

    console.log('Found players:', players.map(p => p.name));

    if (players.length !== 3) {
      const foundNames = players.map(p => p.name);
      const missing = [p1, p2, p3].filter(n => !foundNames.includes(n));
      return res.status(400).json({ error: `Player(s) not found: ${missing.join(', ')}. Please check the usernames.` });
    }

    // Check if any of these players are already enrolled in this tournament
    const existingEnrollment = await db.collection('enrolledtournaments_team').findOne({
      tournament_id: new ObjectId(tournamentId),
      $or: [
        { player1_name: { $in: [p1, p2, p3] } },
        { player2_name: { $in: [p1, p2, p3] } },
        { player3_name: { $in: [p1, p2, p3] } }
      ]
    });
    if (existingEnrollment) {
      return res.status(400).json({ error: 'One or more players are already enrolled in this tournament' });
    }

    // Check wallet balance (only captain pays)
    const balance = await db.collection('user_balances').findOne({ user_id: user._id });
    const walletBalance = balance?.wallet_balance || 0;
    const entryFee = tournament.entry_fee || 0;
    if (walletBalance < entryFee) {
      return res.status(400).json({ error: `Insufficient wallet balance. Required: ₹${entryFee}, Available: ₹${walletBalance}` });
    }

    // Deduct entry fee from captain
    if (entryFee > 0) {
      await db.collection('user_balances').updateOne(
        { user_id: user._id },
        { $inc: { wallet_balance: -entryFee } },
        { upsert: true }
      );
    }

    // Enroll team - captain is auto-approved
    const enrollment = {
      tournament_id: new ObjectId(tournamentId),
      captain_id: user._id,
      captain_name: username,
      player1_name: p1,
      player2_name: p2,
      player3_name: p3,
      player1_approved: p1 === username ? 1 : 0,
      player2_approved: p2 === username ? 1 : 0,
      player3_approved: p3 === username ? 1 : 0,
      approved: 0,
      enrollment_date: new Date()
    };

    // Check if all players are auto-approved
    const allApproved = enrollment.player1_approved && enrollment.player2_approved && enrollment.player3_approved;
    enrollment.approved = allApproved ? 1 : 0;

    await db.collection('enrolledtournaments_team').insertOne(enrollment);

    const newBalance = (await db.collection('user_balances').findOne({ user_id: user._id }))?.wallet_balance || 0;

    const pendingPlayers = [p1, p2, p3].filter(p => p !== username);
    res.json({
      success: true,
      message: `Team submitted! Waiting for approval from: ${pendingPlayers.join(', ')}`,
      walletBalance: newBalance
    });
  } catch (err) {
    console.error('Error in /api/join-team:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 5. GET /api/store
const getStore = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const db = await connectDB();
  const row = await db.collection('users').aggregate([
    { $match: { email: req.session.userEmail, role: 'player', isDeleted: 0 } },
    { $lookup: { from: 'user_balances', localField: '_id', foreignField: 'user_id', as: 'balance' } },
    { $unwind: { path: '$balance', preserveNullAndEmptyArrays: true } },
    { $project: { _id: 1, name: 1, college: 1, wallet_balance: '$balance.wallet_balance' } }
  ]).next();

  if (!row) {
    return res.status(404).json({ error: 'User not found' });
  }

  req.session.userID = row._id.toString();
  req.session.username = row.name;
  req.session.userCollege = row.college;

  const subscription = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
  let discountPercentage = 0;
  if (subscription) {
    if (subscription.plan === 'Basic') discountPercentage = 10;
    else if (subscription.plan === 'Premium') discountPercentage = 20;
  }
  const products = await db.collection('products').find().toArray();

  res.json({
    products: products || [],
    walletBalance: row.wallet_balance || 0,
    playerName: row.name,
    playerCollege: row.college,
    subscription: subscription || null,
    discountPercentage
  });
};

// 6. GET /api/subscription
const getSubscription = async (req, res) => {
  console.log('GET /player/api/subscription - Session:', {
    userEmail: req.session.userEmail,
    userRole: req.session.userRole,
    username: req.session.username
  });

  if (!req.session.userEmail) {
    console.log('GET /player/api/subscription - No userEmail in session');
    return res.status(401).json({ error: 'Please log in' });
  }

  try {
    const db = await connectDB();
    console.log('GET /player/api/subscription - Looking up user with email:', req.session.userEmail);

    const row = await db.collection('users').aggregate([
      { $match: { email: req.session.userEmail, role: 'player', isDeleted: 0 } },
      { $lookup: { from: 'user_balances', localField: '_id', foreignField: 'user_id', as: 'balance' } },
      { $unwind: { path: '$balance', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, wallet_balance: '$balance.wallet_balance' } }
    ]).next();

    if (!row) {
      console.log('GET /player/api/subscription - User not found');
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('GET /player/api/subscription - User found, wallet:', row.wallet_balance);

    let subscription = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
    console.log('GET /player/api/subscription - Subscription:', subscription);

    if (subscription) {
      const now = new Date();
      if (now > new Date(subscription.end_date)) {
        await db.collection('subscriptionstable').deleteOne({ username: req.session.userEmail });
        console.log('GET /player/api/subscription - Expired subscription deleted');
        subscription = null;
      }
    }

    const response = {
      walletBalance: row.wallet_balance || 0,
      currentSubscription: subscription || null
    };
    console.log('GET /player/api/subscription - Sending response:', response);
    res.json(response);
  } catch (err) {
    console.error('GET /player/api/subscription - Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 7. GET /api/growth
const getGrowth = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const db = await connectDB();
  const player = await db.collection('player_stats').aggregate([
    { $lookup: { from: 'users', localField: 'player_id', foreignField: '_id', as: 'user' } },
    { $unwind: '$user' },
    { $match: { 'user.email': req.session.userEmail, 'user.isDeleted': 0 } },
    { $project: { name: '$user.name', gamesPlayed: 1, wins: 1, losses: 1, draws: 1, rating: 1 } }
  ]).next();

  if (!player) {
    return res.status(404).json({ error: 'Player stats not found' });
  }

  const currentRating = player.rating && !isNaN(player.rating) ? player.rating : 400;
  const ratingHistory = player.gamesPlayed > 0
    ? [currentRating - 200, currentRating - 150, currentRating - 100, currentRating - 50, currentRating - 25, currentRating]
    : [400, 400, 400, 400, 400, 400];
  const chartLabels = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - i));
    return date.toLocaleString('default', { month: 'short' });
  });
  const winRate = player.gamesPlayed > 0 ? Math.round((player.wins / player.gamesPlayed) * 100) : 0;

  res.json({
    player: { ...player, winRate: player.winRate || winRate },
    ratingHistory,
    chartLabels
  });
};

// 8. GET /api/profile
const getProfile = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const db = await connectDB();
  const row = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
  if (!row) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const playerId = row._id;
  let playerStats = await db.collection('player_stats').findOne({ player_id: playerId });

  if (!playerStats) {
    const gamesPlayed = Math.floor(Math.random() * 11) + 20;
    let wins = Math.floor(Math.random() * (gamesPlayed + 1));
    let losses = Math.floor(Math.random() * (gamesPlayed - wins + 1));
    let draws = gamesPlayed - (wins + losses);
    let rating = 400 + (wins * 10) - (losses * 10);
    let winRate = gamesPlayed > 0 ? (wins / gamesPlayed) * 100 : 0;

    try {
      await db.collection('player_stats').updateOne(
        { player_id: playerId },
        { $set: { gamesPlayed, wins, losses, draws, winRate, rating } },
        { upsert: true }
      );
      playerStats = { gamesPlayed, wins, losses, draws, winRate, rating };
    } catch (err) {
      console.error('Error updating player stats:', err);
      return res.status(500).json({ error: 'Failed to update player stats' });
    }
  }

  const subscription = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
  const balance = await db.collection('user_balances').findOne({ user_id: playerId });
  console.log('Balance query result:', balance);
  const walletBalance = balance?.wallet_balance || 0;

  const sales = await db.collection('sales').aggregate([
    { $match: { $or: [{ buyer_id: playerId }, { buyer: row.name }] } },
    { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $project: { name: '$product.name' } }
  ]).toArray();

  const subscribed = subscription && new Date(subscription.end_date) > new Date();

  res.json({
    player: {
      ...row,
      subscription: subscription || { plan: 'None', price: 0, start_date: 'N/A' },
      walletBalance,
      gamesPlayed: playerStats.gamesPlayed,
      wins: playerStats.wins,
      losses: playerStats.losses,
      draws: playerStats.draws,
      winRate: playerStats.winRate,
      rating: playerStats.rating,
      sales: sales.map(sale => sale.name)
    },
    subscribed
  });
};

// 9. POST /api/profile/photo
const uploadPhoto = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded. Use field name "photo".' });
  }

  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const existingPublicId = (user.profile_photo_public_id || '').toString();
    const desiredPublicId = existingPublicId || `chesshive/profile-photos/player_${user._id}`;

    const result = await uploadImageBuffer(req.file.buffer, {
      folder: 'chesshive/profile-photos',
      public_id: desiredPublicId.split('/').pop(),
      overwrite: true,
      invalidate: true
    });

    const newUrl = result?.secure_url;
    const newPublicId = result?.public_id;
    if (!newUrl || !newPublicId) {
      return res.status(500).json({ error: 'Failed to upload profile photo' });
    }

    // Best-effort cleanup of previous Cloudinary asset (if public_id changed)
    if (existingPublicId && existingPublicId !== newPublicId) {
      await destroyImage(existingPublicId);
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { profile_photo_url: newUrl, profile_photo_public_id: newPublicId, updated_date: new Date() } }
    );

    return res.json({ success: true, profile_photo_url: newUrl });
  } catch (err) {
    console.error('Error updating profile photo:', err);
    return res.status(500).json({ error: 'Failed to update profile photo' });
  }
};

// Multer middleware for photo upload
const uploadPhotoMiddleware = (req, res, next) => {
  if (!multer) {
    return res.status(500).json({ error: 'Upload support is not available (multer not installed).' });
  }
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }

  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (r, file, cb) => {
      const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes((file.mimetype || '').toLowerCase());
      if (!ok) return cb(new Error('Only image files (jpg, png, webp, gif) are allowed.'));
      cb(null, true);
    }
  }).single('photo');

  uploader(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    return next();
  });
};

// 10. PUT /api/profile
const updateProfile = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }

  try {
    const { name, dob, phone, AICF_ID, FIDE_ID } = req.body || {};

    const set = {};
    const unset = {};

    if (name !== undefined) {
      const v = (name ?? '').toString().trim();
      if (!v) return res.status(400).json({ error: 'Name is required' });
      set.name = v;
    }

    if (phone !== undefined) {
      const v = (phone ?? '').toString().trim();
      if (!v) unset.phone = '';
      else set.phone = v;
    }

    if (AICF_ID !== undefined) {
      const v = (AICF_ID ?? '').toString().trim();
      if (!v) unset.AICF_ID = '';
      else set.AICF_ID = v;
    }

    if (FIDE_ID !== undefined) {
      const v = (FIDE_ID ?? '').toString().trim();
      if (!v) unset.FIDE_ID = '';
      else set.FIDE_ID = v;
    }

    if (dob !== undefined) {
      const v = (dob ?? '').toString().trim();
      if (!v) {
        unset.dob = '';
      } else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Invalid dob. Use YYYY-MM-DD.' });
        }
        set.dob = d;
      }
    }

    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const updateDoc = {};
    if (Object.keys(set).length) updateDoc.$set = { ...set, updated_date: new Date() };
    if (Object.keys(unset).length) updateDoc.$unset = unset;
    await db.collection('users').updateOne({ _id: user._id }, updateDoc);

    return res.json({ success: true });
  } catch (err) {
    console.error('Error updating player profile:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
};

// 11. DELETE /api/deleteAccount
const deleteAccount = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }

  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({
      email: req.session.userEmail,
      role: 'player'
    });

    if (!user) return res.status(404).json({ error: 'Player not found' });

    const playerId = user._id;

    // Soft delete in users collection (includes deleted_by and deletedAt)
    await db.collection('users').updateOne(
      { _id: playerId },
      { $set: { isDeleted: 1, deleted_date: new Date(), deleted_by: req.session.userEmail } }
    );
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ message: 'Account deleted successfully (soft delete)' });
    });
  } catch (err) {
    console.error('Error deleting account:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};

// 12. POST /players/restore/:id
const restorePlayer = async (req, res) => {
  const db = await connectDB();
  const playerId = req.params.id;
  const { email, password } = req.body;

  try {
    const user = await db.collection('users').findOne({
      _id: new ObjectId(playerId),
      role: 'player'
    });

    if (!user) return res.status(404).json({ message: 'Player account not found.' });

    if (user.isDeleted === 0) {
      return res.status(400).json({ message: 'Account is already active.' });
    }

    if (user.email !== email) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const passwordOk = await verifyPasswordAndMaybeMigrate(db, user, password);
    if (!passwordOk) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Restore by setting isDeleted back to 0
    await db.collection('users').updateOne(
      { _id: new ObjectId(playerId) },
      { $set: { isDeleted: 0 }, $unset: { deletedAt: "" } }
    );

    await db.collection('player_stats').updateOne(
      { player_id: new ObjectId(playerId) },
      { $set: { isDeleted: 0 } }
    );

    await db.collection('user_balances').updateOne(
      { user_id: new ObjectId(playerId) },
      { $set: { isDeleted: 0 } }
    );

    await db.collection('subscriptionstable').updateOne(
      { username: user.email },
      { $set: { isDeleted: 0 } }
    );

    await db.collection('sales').updateMany(
      { buyer: user.name },
      { $set: { isDeleted: 0 } }
    );

    return res.status(200).json({ message: 'Player account restored successfully! You can now log in.' });
  } catch (err) {
    console.error('Error restoring player:', err);
    return res.status(500).json({ message: 'Failed to restore player account.' });
  }
};

// 13. GET /api/compare
const comparePlayer = async (req, res) => {
  const db = await connectDB();
  const query = req.query.query?.trim();

  if (!query) {
    return res.status(400).json({ error: 'Please provide a name or email to compare.' });
  }

  try {
    const player = await db.collection('users').findOne({
      $or: [{ email: query }, { name: query }],
      role: 'player',
      isDeleted: { $ne: 1 }
    });

    if (!player) {
      return res.status(404).json({ error: 'Player not found.' });
    }

    const stats = await db.collection('player_stats').findOne({
      player_id: player._id,
      isDeleted: { $ne: 1 }
    });

    // Dummy rating history (replace with real match history data)
    const ratingHistory = Array.from({ length: 10 }, (_, i) =>
      (stats?.rating || 400) + Math.floor(Math.random() * 100 - 50)
    );

    res.json({
      player: {
        name: player.name,
        email: player.email,
        rating: stats?.rating || 400,
        winRate: stats?.winRate || 0,
        ratingHistory
      }
    });
  } catch (err) {
    console.error('Error comparing players:', err);
    res.status(500).json({ error: 'Failed to compare players.' });
  }
};

// 14. POST /api/add-funds
const addFunds = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }

  const db = await connectDB();
  const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const result = await db.collection('user_balances').updateOne(
    { user_id: user._id },
    { $inc: { wallet_balance: amount } },
    { upsert: true }
  );

  if (result.matchedCount === 0 && result.upsertedCount === 0) {
    return res.status(500).json({ error: 'Failed to update balance' });
  }

  const newBalance = (await db.collection('user_balances').findOne({ user_id: user._id })).wallet_balance || amount;
  res.json({ success: true, walletBalance: newBalance });
};

// 15. GET /api/pairings
const getPairings = async (req, res) => {
  const tournamentId = req.query.tournament_id;
  const totalRounds = parseInt(req.query.rounds) || 5;
  if (!tournamentId) {
    return res.status(400).json({ error: 'Tournament ID is required' });
  }

  const db = await connectDB();
  const rows = await db.collection('tournament_players').find({ tournament_id: new ObjectId(tournamentId) }).toArray();
  if (rows.length === 0) {
    return res.json({ roundNumber: 1, allRounds: [], message: 'No players enrolled' });
  }

  let storedPairings = await db.collection('tournament_pairings').findOne({ tournament_id: new ObjectId(tournamentId) });
  let allRounds;

  // Regenerate pairings if no stored data or player count mismatch
  if (!storedPairings || storedPairings.totalRounds !== totalRounds || rows.length !== (storedPairings.rounds[0]?.pairings?.length * 2 || 0) + (storedPairings.rounds[0]?.byePlayer ? 1 : 0)) {
    console.log(`Regenerating pairings for ${rows.length} players`);
    let players = rows.map(row => new Player(row._id, row.username, row.college, row.gender));
    allRounds = swissPairing(players, totalRounds);

    await db.collection('tournament_pairings').deleteOne({ tournament_id: new ObjectId(tournamentId) });
    await db.collection('tournament_pairings').insertOne({
      tournament_id: new ObjectId(tournamentId),
      totalRounds: totalRounds,
      rounds: allRounds.map(round => ({
        round: round.round,
        pairings: round.pairings.map(pairing => ({
          player1: { id: pairing.player1.id, username: pairing.player1.username, score: pairing.player1.score },
          player2: { id: pairing.player2.id, username: pairing.player2.username, score: pairing.player2.score },
          result: pairing.result
        })),
        byePlayer: round.byePlayer ? {
          id: round.byePlayer.id,
          username: round.byePlayer.username,
          score: round.byePlayer.score
        } : null
      }))
    });
  } else {
    console.log('Using existing stored pairings');
    allRounds = storedPairings.rounds.map(round => {
      const pairings = round.pairings.map(pairing => {
        const player1 = new Player(pairing.player1.id, pairing.player1.username);
        player1.score = pairing.player1.score;
        const player2 = new Player(pairing.player2.id, pairing.player2.username);
        player2.score = pairing.player2.score;
        return { player1, player2, result: pairing.result };
      });
      const byePlayer = round.byePlayer ? new Player(round.byePlayer.id, round.byePlayer.username) : null;
      if (byePlayer) byePlayer.score = round.byePlayer.score;
      return { round: round.round, pairings, byePlayer };
    });
  }

  res.json({ roundNumber: totalRounds, allRounds });
};

// 16. GET /api/rankings
const getRankings = async (req, res) => {
  try {
    const tournamentId = req.query.tournament_id;
    if (!tournamentId) {
      return res.status(400).json({ error: 'Tournament ID is required' });
    }
    const db = await connectDB();
    const tid = new ObjectId(tournamentId);
    const rows = await db.collection('tournament_players').find({ tournament_id: tid }).toArray();
    if (rows.length === 0) {
      return res.json({ rankings: [], tournamentId });
    }
    let storedPairings = await db.collection('tournament_pairings').findOne({ tournament_id: tid });
    let rankings = [];
    if (!storedPairings) {
      const totalRounds = 5;
      let players = rows.map(row => new Player(row._id, row.username, row.college, row.gender));
      const allRounds = swissPairing(players, totalRounds);
      await db.collection('tournament_pairings').insertOne({
        tournament_id: tid,
        totalRounds: totalRounds,
        rounds: allRounds.map(round => ({
          round: round.round,
          pairings: round.pairings.map(pairing => ({
            player1: {
              id: pairing.player1.id,
              username: pairing.player1.username,
              score: pairing.player1.score
            },
            player2: {
              id: pairing.player2.id,
              username: pairing.player2.username,
              score: pairing.player2.score
            },
            result: pairing.result
          })),
          byePlayer: round.byePlayer ? {
            id: round.byePlayer.id,
            username: round.byePlayer.username,
            score: round.byePlayer.score
          } : null
        }))
      });
      rankings = players.sort((a, b) => b.score - a.score).map((p, index) => ({
        rank: index + 1,
        playerName: p.username,
        score: p.score
      }));
    } else {
      let playersMap = new Map();
      rows.forEach(row => {
        playersMap.set(row._id.toString(), {
          id: row._id.toString(),
          username: row.username,
          score: 0
        });
      });
      storedPairings.rounds.forEach(round => {
        round.pairings.forEach(pairing => {
          const player1 = playersMap.get(pairing.player1.id.toString());
          const player2 = playersMap.get(pairing.player2.id.toString());
          if (player1) player1.score = pairing.player1.score;
          if (player2) player2.score = pairing.player2.score;
        });
        if (round.byePlayer) {
          const byePlayer = playersMap.get(round.byePlayer.id.toString());
          if (byePlayer) byePlayer.score = round.byePlayer.score;
        }
      });
      rankings = Array.from(playersMap.values())
        .sort((a, b) => b.score - a.score)
        .map((p, index) => ({
          rank: index + 1,
          playerName: p.username,
          score: p.score
        }));
    }
    res.json({ rankings, tournamentId });
  } catch (error) {
    console.error('Error fetching rankings:', error);
    res.status(500).json({ error: 'Failed to fetch rankings' });
  }
};

// 17. GET /api/team-pairings
const getTeamPairings = async (req, res) => {
  const tournamentId = req.query.tournament_id;
  const totalRounds = parseInt(req.query.rounds) || 5;
  if (!tournamentId) {
    return res.status(400).json({ error: 'Tournament ID is required' });
  }

  try {
    const db = await connectDB();
    const tid = new ObjectId(tournamentId);

    // Check tournament exists and is a team tournament
    const tournament = await db.collection('tournaments').findOne({ _id: tid });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentType = (tournament.type || '').toLowerCase();
    if (!['team', 'group'].includes(tournamentType)) {
      return res.status(400).json({ error: 'This is not a team tournament' });
    }

    // Get ONLY fully approved teams (all 3 members approved)
    const approvedTeams = await db.collection('enrolledtournaments_team').find({
      tournament_id: tid,
      approved: 1
    }).toArray();

    if (approvedTeams.length === 0) {
      return res.json({ roundNumber: 1, allRounds: [], message: 'No approved teams enrolled' });
    }

    let storedPairings = await db.collection('tournament_team_pairings').findOne({ tournament_id: tid });
    let allRounds;

    // Regenerate pairings if no stored data or team count mismatch
    const expectedTeamCount = storedPairings?.rounds?.[0]?.pairings?.length * 2 + (storedPairings?.rounds?.[0]?.byeTeam ? 1 : 0);
    if (!storedPairings || storedPairings.totalRounds !== totalRounds || approvedTeams.length !== expectedTeamCount) {
      console.log(`Regenerating team pairings for ${approvedTeams.length} teams`);

      // Create Team objects from approved enrollments
      let teams = approvedTeams.map(enrollment => new Team(
        enrollment._id,
        `Team ${enrollment.captain_name}`,
        enrollment.captain_name,
        enrollment.player1_name,
        enrollment.player2_name,
        enrollment.player3_name
      ));

      allRounds = swissTeamPairing(teams, totalRounds);

      await db.collection('tournament_team_pairings').deleteOne({ tournament_id: tid });
      await db.collection('tournament_team_pairings').insertOne({
        tournament_id: tid,
        totalRounds: totalRounds,
        rounds: allRounds.map(round => ({
          round: round.round,
          pairings: round.pairings.map(pairing => ({
            team1: {
              id: pairing.team1.id,
              teamName: pairing.team1.teamName,
              captainName: pairing.team1.captainName,
              player1: pairing.team1.player1,
              player2: pairing.team1.player2,
              player3: pairing.team1.player3,
              score: pairing.team1.score
            },
            team2: {
              id: pairing.team2.id,
              teamName: pairing.team2.teamName,
              captainName: pairing.team2.captainName,
              player1: pairing.team2.player1,
              player2: pairing.team2.player2,
              player3: pairing.team2.player3,
              score: pairing.team2.score
            },
            result: pairing.result
          })),
          byeTeam: round.byeTeam ? {
            id: round.byeTeam.id,
            teamName: round.byeTeam.teamName,
            captainName: round.byeTeam.captainName,
            player1: round.byeTeam.player1,
            player2: round.byeTeam.player2,
            player3: round.byeTeam.player3,
            score: round.byeTeam.score
          } : null
        }))
      });
    } else {
      console.log('Using existing stored team pairings');
      allRounds = storedPairings.rounds.map(round => {
        const pairings = round.pairings.map(pairing => {
          const team1 = new Team(pairing.team1.id, pairing.team1.teamName, pairing.team1.captainName, pairing.team1.player1, pairing.team1.player2, pairing.team1.player3);
          team1.score = pairing.team1.score;
          const team2 = new Team(pairing.team2.id, pairing.team2.teamName, pairing.team2.captainName, pairing.team2.player1, pairing.team2.player2, pairing.team2.player3);
          team2.score = pairing.team2.score;
          return { team1, team2, result: pairing.result };
        });
        const byeTeam = round.byeTeam ? new Team(round.byeTeam.id, round.byeTeam.teamName, round.byeTeam.captainName, round.byeTeam.player1, round.byeTeam.player2, round.byeTeam.player3) : null;
        if (byeTeam) byeTeam.score = round.byeTeam.score;
        return { round: round.round, pairings, byeTeam };
      });
    }

    res.json({ roundNumber: totalRounds, allRounds, isTeamTournament: true });
  } catch (error) {
    console.error('Error fetching team pairings:', error);
    res.status(500).json({ error: 'Failed to fetch team pairings' });
  }
};

// 18. GET /api/team-rankings
const getTeamRankings = async (req, res) => {
  try {
    const tournamentId = req.query.tournament_id;
    if (!tournamentId) {
      return res.status(400).json({ error: 'Tournament ID is required' });
    }
    const db = await connectDB();
    const tid = new ObjectId(tournamentId);

    // Check tournament exists and is a team tournament
    const tournament = await db.collection('tournaments').findOne({ _id: tid });
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    const tournamentType = (tournament.type || '').toLowerCase();
    if (!['team', 'group'].includes(tournamentType)) {
      return res.status(400).json({ error: 'This is not a team tournament' });
    }

    // Get approved teams
    const approvedTeams = await db.collection('enrolledtournaments_team').find({
      tournament_id: tid,
      approved: 1
    }).toArray();

    if (approvedTeams.length === 0) {
      return res.json({ rankings: [], tournamentId, isTeamTournament: true });
    }

    let storedPairings = await db.collection('tournament_team_pairings').findOne({ tournament_id: tid });
    let rankings = [];

    if (!storedPairings) {
      const totalRounds = 5;
      let teams = approvedTeams.map(enrollment => new Team(
        enrollment._id,
        `Team ${enrollment.captain_name}`,
        enrollment.captain_name,
        enrollment.player1_name,
        enrollment.player2_name,
        enrollment.player3_name
      ));

      const allRounds = swissTeamPairing(teams, totalRounds);
      await db.collection('tournament_team_pairings').insertOne({
        tournament_id: tid,
        totalRounds: totalRounds,
        rounds: allRounds.map(round => ({
          round: round.round,
          pairings: round.pairings.map(pairing => ({
            team1: {
              id: pairing.team1.id,
              teamName: pairing.team1.teamName,
              captainName: pairing.team1.captainName,
              player1: pairing.team1.player1,
              player2: pairing.team1.player2,
              player3: pairing.team1.player3,
              score: pairing.team1.score
            },
            team2: {
              id: pairing.team2.id,
              teamName: pairing.team2.teamName,
              captainName: pairing.team2.captainName,
              player1: pairing.team2.player1,
              player2: pairing.team2.player2,
              player3: pairing.team2.player3,
              score: pairing.team2.score
            },
            result: pairing.result
          })),
          byeTeam: round.byeTeam ? {
            id: round.byeTeam.id,
            teamName: round.byeTeam.teamName,
            captainName: round.byeTeam.captainName,
            player1: round.byeTeam.player1,
            player2: round.byeTeam.player2,
            player3: round.byeTeam.player3,
            score: round.byeTeam.score
          } : null
        }))
      });

      rankings = teams.sort((a, b) => b.score - a.score).map((t, index) => ({
        rank: index + 1,
        teamName: t.teamName,
        captainName: t.captainName,
        players: [t.player1, t.player2, t.player3],
        score: t.score
      }));
    } else {
      let teamsMap = new Map();
      approvedTeams.forEach(enrollment => {
        teamsMap.set(enrollment._id.toString(), {
          id: enrollment._id.toString(),
          teamName: `Team ${enrollment.captain_name}`,
          captainName: enrollment.captain_name,
          players: [enrollment.player1_name, enrollment.player2_name, enrollment.player3_name],
          score: 0
        });
      });

      storedPairings.rounds.forEach(round => {
        round.pairings.forEach(pairing => {
          const team1 = teamsMap.get(pairing.team1.id.toString());
          const team2 = teamsMap.get(pairing.team2.id.toString());
          if (team1) team1.score = pairing.team1.score;
          if (team2) team2.score = pairing.team2.score;
        });
        if (round.byeTeam) {
          const byeTeam = teamsMap.get(round.byeTeam.id.toString());
          if (byeTeam) byeTeam.score = round.byeTeam.score;
        }
      });

      rankings = Array.from(teamsMap.values())
        .sort((a, b) => b.score - a.score)
        .map((t, index) => ({
          rank: index + 1,
          teamName: t.teamName,
          captainName: t.captainName,
          players: t.players,
          score: t.score
        }));
    }

    res.json({ rankings, tournamentId, isTeamTournament: true });
  } catch (error) {
    console.error('Error fetching team rankings:', error);
    res.status(500).json({ error: 'Failed to fetch team rankings' });
  }
};

// 19. POST /api/approve-team-request
const approveTeamRequest = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ error: 'Please log in' });
  }
  const { requestId } = req.body;
  if (!requestId) {
    return res.status(400).json({ error: 'Request ID is required' });
  }

  const db = await connectDB();
  const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
  if (!user) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const teamRequest = await db.collection('enrolledtournaments_team').findOne({ _id: new ObjectId(requestId) });
  if (!teamRequest) {
    return res.status(404).json({ error: 'Team request not found' });
  }

  // Update approval based on player's role in team
  const update = {};
  if (teamRequest.player1_name === user.name) {
    update.player1_approved = 1;
  } else if (teamRequest.player2_name === user.name) {
    update.player2_approved = 1;
  } else if (teamRequest.player3_name === user.name) {
    update.player3_approved = 1;
  } else {
    return res.status(403).json({ error: 'You are not part of this team' });
  }

  // Check if all players approved
  const updatedRequest = {
    ...teamRequest,
    ...update,
    approved: (teamRequest.player1_approved || update.player1_approved) &&
              (teamRequest.player2_approved || update.player2_approved) &&
              (teamRequest.player3_approved || update.player3_approved) ? 1 : 0
  };

  await db.collection('enrolledtournaments_team').updateOne(
    { _id: new ObjectId(requestId) },
    { $set: { ...update, approved: updatedRequest.approved } }
  );

  res.json({ success: true });
};

// 20. POST /api/buy
const buyProduct = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ success: false, message: 'Please log in' });
  }

  try {
    const db = await connectDB();
    const { price, buyer, college, productId } = req.body;

    if (!price || !productId) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const user = await db.collection('users').findOne({
      email: req.session.userEmail,
      role: 'player',
      isDeleted: 0
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const balanceDoc = await db.collection('user_balances').findOne({ user_id: user._id });
    const walletBalance = balanceDoc?.wallet_balance || 0;
    const numericPrice = parseFloat(price);

    if (walletBalance < numericPrice) {
      return res.json({ success: false, message: 'Insufficient wallet balance' });
    }

    // Check product availability
    console.log('Checking product availability');
    const product = await db.collection('products').findOne({ _id: new ObjectId(productId) });
    if (!product || product.availability <= 0) {
      return res.json({ success: false, message: 'Product unavailable' });
    }

    // Deduct wallet balance and reduce availability
    console.log('Deducting balance and updating product availability');
    await db.collection('user_balances').updateOne(
      { user_id: user._id },
      { $inc: { wallet_balance: -numericPrice } },
      { upsert: true }
    );
    console.log('Updating product availability');
    await db.collection('products').updateOne(
      { _id: new ObjectId(productId) },
      { $inc: { availability: -1 } }
    );

    // Record the sale
    await db.collection('sales').insertOne({
      product_id: new ObjectId(productId),
      price: Number(numericPrice),
      buyer: String(buyer),
      buyer_id: user._id,
      college: String(college),
      purchase_date: new Date()
    });

    // Return actual updated balance from DB
    const newBalanceDoc = await db.collection('user_balances').findOne({ user_id: user._id });
    const updatedBalance = newBalanceDoc?.wallet_balance ?? (walletBalance - numericPrice);
    res.json({ success: true, message: 'Purchase successful!', walletBalance: updatedBalance });

  } catch (err) {
    console.error('Error in /api/buy:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// 21. POST /api/subscribe
const subscribePlan = async (req, res) => {
  if (!req.session.userEmail) {
    return res.status(401).json({ success: false, message: 'Please log in' });
  }

  try {
    const { plan, price } = req.body;
    if (!plan || !price) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const db = await connectDB();
    const user = await db.collection('users').findOne({
      email: req.session.userEmail,
      role: 'player',
      isDeleted: 0
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check wallet balance
    const balanceDoc = await db.collection('user_balances').findOne({ user_id: user._id });
    const walletBalance = balanceDoc?.wallet_balance || 0;
    const numericPrice = parseFloat(price);

    if (walletBalance < numericPrice) {
      return res.json({ success: false, message: 'Insufficient wallet balance' });
    }

    // Deduct funds
    await db.collection('user_balances').updateOne(
      { user_id: user._id },
      { $inc: { wallet_balance: -numericPrice } }
    );

    // Set subscription duration (1 month)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(startDate.getMonth() + 1);

    const subscriptionDoc = {
      username: req.session.userEmail,
      plan,
      price: numericPrice,
      start_date: startDate,
      end_date: endDate
    };

    console.log('Attempting to save subscription:', JSON.stringify(subscriptionDoc, null, 2));

    // Save subscription
    await db.collection('subscriptionstable').updateOne(
      { username: req.session.userEmail },
      { $set: subscriptionDoc },
      { upsert: true }
    );

    const updatedBalance = walletBalance - numericPrice;
    res.json({
      success: true,
      message: 'Subscription successful!',
      walletBalance: updatedBalance
    });
  } catch (err) {
    console.error('Error in /api/subscribe:', err);
    if (err.code === 121) {
      console.error('Validation error details:', JSON.stringify(err.errInfo, null, 2));
    }
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  }
};

// 22. GET /api/growth_analytics (ENHANCED: game history, white/black stats, pie, streaks, multi-rating)
const getGrowthAnalytics = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    let stats = await db.collection('player_stats').findOne({ player_id: user._id });
    if (!stats) {
      // Initialize with rating 500
      stats = { player_id: user._id, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, rating: 500, winRate: 0,
        classical_rating: 500, blitz_rating: 500, rapid_rating: 500,
        white_wins: 0, white_losses: 0, white_draws: 0, white_games: 0,
        black_wins: 0, black_losses: 0, black_draws: 0, black_games: 0,
        win_streak: 0, lose_streak: 0, best_win_streak: 0, worst_lose_streak: 0,
        greatest_win: null, worst_loss: null, peakRating: 500
      };
      await db.collection('player_stats').updateOne({ player_id: user._id }, { $set: stats }, { upsert: true });
    }

    // Ensure initial rating 500 for unrated players
    const rating = stats.rating || 500;
    const peakRating = stats.peakRating || Math.max(rating, 500);

    // Game history from match_history collection
    const gameHistory = await db.collection('match_history').find({ player_id: user._id })
      .sort({ date: -1 }).limit(50).toArray();

    // Rating history over time
    const ratingEntries = await db.collection('rating_history').find({ player_id: user._id })
      .sort({ date: 1 }).toArray();

    let ratingHistory, chartLabels;
    if (ratingEntries.length > 0) {
      ratingHistory = ratingEntries.map(e => e.rating);
      chartLabels = ratingEntries.map(e => {
        const d = new Date(e.date);
        return d.toLocaleString('default', { month: 'short', year: '2-digit' });
      });
    } else {
      // Generate simulated history from current rating
      const r = rating;
      ratingHistory = [500, Math.round(500 + (r - 500) * 0.2), Math.round(500 + (r - 500) * 0.4),
        Math.round(500 + (r - 500) * 0.6), Math.round(500 + (r - 500) * 0.8), r];
      chartLabels = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
        return d.toLocaleString('default', { month: 'short' });
      });
    }

    // Multi-rating type history
    const classicalHistory = await db.collection('rating_history').find({ player_id: user._id, type: 'classical' }).sort({ date: 1 }).toArray();
    const blitzHistory = await db.collection('rating_history').find({ player_id: user._id, type: 'blitz' }).sort({ date: 1 }).toArray();
    const rapidHistory = await db.collection('rating_history').find({ player_id: user._id, type: 'rapid' }).sort({ date: 1 }).toArray();

    const gamesPlayed = stats.gamesPlayed || 0;
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    const draws = stats.draws || 0;
    const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

    res.json({
      player: {
        gamesPlayed, wins, losses, draws, winRate, rating, peakRating,
        classical_rating: stats.classical_rating || 500,
        blitz_rating: stats.blitz_rating || 500,
        rapid_rating: stats.rapid_rating || 500,
        white_wins: stats.white_wins || 0, white_losses: stats.white_losses || 0,
        white_draws: stats.white_draws || 0, white_games: stats.white_games || 0,
        black_wins: stats.black_wins || 0, black_losses: stats.black_losses || 0,
        black_draws: stats.black_draws || 0, black_games: stats.black_games || 0,
        win_streak: stats.win_streak || 0, lose_streak: stats.lose_streak || 0,
        best_win_streak: stats.best_win_streak || 0, worst_lose_streak: stats.worst_lose_streak || 0,
        greatest_win: stats.greatest_win || null,
        worst_loss: stats.worst_loss || null
      },
      ratingHistory, chartLabels,
      gameHistory: (gameHistory || []).map(g => ({
        opponent: g.opponent, result: g.result, date: g.date,
        color: g.color, ratingChange: g.ratingChange, tournament: g.tournament_name
      })),
      pieData: { wins, losses, draws },
      ratingTypes: {
        classical: classicalHistory.map(e => ({ date: e.date, rating: e.rating })),
        blitz: blitzHistory.map(e => ({ date: e.date, rating: e.rating })),
        rapid: rapidHistory.map(e => ({ date: e.date, rating: e.rating }))
      }
    });
  } catch (err) {
    console.error('Error loading growth analytics:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

// 23. GET /api/notifications
const getNotifications = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });

  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const notifications = await db.collection('notifications').aggregate([
      { $match: { user_id: user._id } },
      { $lookup: { from: 'tournaments', localField: 'tournament_id', foreignField: '_id', as: 'tournament' } },
      { $unwind: '$tournament' },
      {
        $project: {
          _id: 1,
          type: 1,
          read: 1,
          date: 1,
          tournamentName: '$tournament.name',
          tournament_id: '$tournament._id'
        }
      }
    ]).toArray();

    // Convert ObjectId to string
    const formattedNotifications = notifications.map(n => ({
      ...n,
      _id: n._id.toString(),
      tournament_id: n.tournament_id.toString()
    }));
    console.log('Sending notifications:', formattedNotifications);
    res.json({ notifications: formattedNotifications });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications', details: error.message });
  }
};

// 24. POST /api/submit-feedback
const submitFeedback = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });

  const { tournamentId, rating, comments } = req.body;
  if (!tournamentId || !rating) return res.status(400).json({ error: 'Tournament ID and rating required' });
  if (!ObjectId.isValid(tournamentId)) {
    console.error('Invalid tournamentId:', tournamentId);
    return res.status(400).json({ error: 'Invalid tournament ID' });
  }
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    // Check if already submitted
    const existing = await db.collection('feedbacks').findOne({ tournament_id: new ObjectId(tournamentId), username: user.name });
    if (existing) return res.status(400).json({ error: 'Feedback already submitted' });

    await db.collection('feedbacks').insertOne({
      tournament_id: new ObjectId(tournamentId),
      username: user.name,
      rating: parseInt(rating),
      comments: comments || '',
      submitted_date: new Date()
    });

    res.json({ success: true, message: 'Feedback submitted' });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

// 25. POST /api/mark-notification-read
const markNotificationRead = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });

  const { notificationId } = req.body;
  if (!notificationId) return res.status(400).json({ error: 'Notification ID required' });

  try {
    const db = await connectDB();
    await db.collection('notifications').updateOne(
      { _id: new ObjectId(notificationId) },
      { $set: { read: true } }
    );
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking read:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
};

// 26. GET /api/streams
const getPlayerStreams = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });

  try {
    const db = await connectDB();
    // Fetch all live or featured streams (visible to players)
    const streams = await db.collection('streams')
      .find({ $or: [{ isLive: true }, { featured: true }] })
      .sort({ featured: -1, updatedAt: -1, createdAt: -1 })
      .toArray();

    const out = (streams || []).map(s => ({
      _id: s._id ? s._id.toString() : undefined,
      title: s.title,
      url: s.url,
      platform: s.platform,
      matchLabel: s.matchLabel,
      description: s.description,
      result: s.result,
      isLive: s.isLive,
      featured: s.featured,
      createdByName: s.createdByName,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt,
    }));

    return res.json(out);
  } catch (error) {
    console.error('Error fetching streams for player:', error);
    return res.status(500).json({ error: 'Failed to fetch streams' });
  }
};

// ===================== CART MANAGEMENT =====================

// 27. GET /api/cart
const getCart = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const cartItems = await db.collection('cart').aggregate([
      { $match: { user_id: user._id } },
      { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $project: { _id: 1, product_id: 1, quantity: 1, added_date: 1,
          name: '$product.name', price: '$product.price', category: '$product.category',
          availability: '$product.availability', image_url: '$product.image_url' } }
    ]).toArray();

    res.json({ cart: cartItems });
  } catch (err) {
    console.error('Error fetching cart:', err);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
};

// 28. POST /api/cart/add
const addToCart = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  const { productId, quantity } = req.body;
  if (!productId) return res.status(400).json({ error: 'Product ID required' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const product = await db.collection('products').findOne({ _id: new ObjectId(productId) });
    if (!product || product.availability <= 0) return res.status(400).json({ error: 'Product unavailable' });

    const qty = Math.max(1, parseInt(quantity) || 1);
    const existing = await db.collection('cart').findOne({ user_id: user._id, product_id: new ObjectId(productId) });
    if (existing) {
      await db.collection('cart').updateOne(
        { _id: existing._id },
        { $set: { quantity: existing.quantity + qty, updated_date: new Date() } }
      );
    } else {
      await db.collection('cart').insertOne({
        user_id: user._id, product_id: new ObjectId(productId),
        quantity: qty, added_date: new Date()
      });
    }
    res.json({ success: true, message: 'Added to cart' });
  } catch (err) {
    console.error('Error adding to cart:', err);
    res.status(500).json({ error: 'Failed to add to cart' });
  }
};

// 29. DELETE /api/cart/remove
const removeFromCart = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  const { cartItemId } = req.body;
  if (!cartItemId) return res.status(400).json({ error: 'Cart item ID required' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });
    await db.collection('cart').deleteOne({ _id: new ObjectId(cartItemId), user_id: user._id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error removing from cart:', err);
    res.status(500).json({ error: 'Failed to remove from cart' });
  }
};

// 30. DELETE /api/cart/clear
const clearCart = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });
    await db.collection('cart').deleteMany({ user_id: user._id });
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing cart:', err);
    res.status(500).json({ error: 'Failed to clear cart' });
  }
};

// ===================== ORDER MANAGEMENT =====================

// 31. POST /api/orders (place order from cart or direct buy)
const placeOrder = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const { items, address } = req.body; // items: [{productId, quantity}], address: string
    let orderItems = [];

    if (items && items.length > 0) {
      // Direct order with items
      for (const item of items) {
        const product = await db.collection('products').findOne({ _id: new ObjectId(item.productId) });
        if (!product) return res.status(400).json({ error: `Product ${item.productId} not found` });
        if (product.availability < (item.quantity || 1)) return res.status(400).json({ error: `${product.name} not available in requested quantity` });
        orderItems.push({ product_id: product._id, name: product.name, price: product.price,
          quantity: item.quantity || 1, image_url: product.image_url || '' });
      }
    } else {
      // Order from cart
      const cartItems = await db.collection('cart').aggregate([
        { $match: { user_id: user._id } },
        { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' }
      ]).toArray();
      if (cartItems.length === 0) return res.status(400).json({ error: 'Cart is empty' });
      for (const ci of cartItems) {
        if (ci.product.availability < ci.quantity) return res.status(400).json({ error: `${ci.product.name} not available` });
        orderItems.push({ product_id: ci.product._id, name: ci.product.name, price: ci.product.price,
          quantity: ci.quantity, image_url: ci.product.image_url || '' });
      }
    }

    // Calculate total with subscription discount
    const subscription = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
    let discountPct = 0;
    if (subscription) {
      if (subscription.plan === 'Basic') discountPct = 10;
      else if (subscription.plan === 'Premium') discountPct = 20;
    }

    let total = 0;
    orderItems.forEach(oi => {
      const discount = (oi.price * discountPct) / 100;
      oi.finalPrice = Number((oi.price - discount).toFixed(2));
      total += oi.finalPrice * oi.quantity;
    });
    total = Number(total.toFixed(2));

    // Check wallet
    const balDoc = await db.collection('user_balances').findOne({ user_id: user._id });
    const walletBalance = balDoc?.wallet_balance || 0;
    if (walletBalance < total) return res.status(400).json({ error: `Insufficient balance. Need ₹${total}, have ₹${walletBalance}` });

    // Deduct balance
    await db.collection('user_balances').updateOne({ user_id: user._id }, { $inc: { wallet_balance: -total } });

    // Reduce product availability
    for (const oi of orderItems) {
      await db.collection('products').updateOne({ _id: oi.product_id }, { $inc: { availability: -oi.quantity } });
    }

    // Create order
    const order = {
      user_id: user._id, username: user.name, email: req.session.userEmail,
      items: orderItems, total, discount_percentage: discountPct,
      address: address || '', status: 'confirmed',
      tracking: [{ status: 'confirmed', date: new Date(), note: 'Order placed successfully' }],
      order_date: new Date(), estimated_delivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    };
    const result = await db.collection('orders').insertOne(order);

    // Record sales
    for (const oi of orderItems) {
      await db.collection('sales').insertOne({
        product_id: oi.product_id, price: oi.finalPrice, buyer: user.name, buyer_id: user._id,
        college: user.college || '', purchase_date: new Date(), order_id: result.insertedId
      });
    }

    // Clear cart
    await db.collection('cart').deleteMany({ user_id: user._id });

    const newBal = (await db.collection('user_balances').findOne({ user_id: user._id }))?.wallet_balance || 0;
    res.json({ success: true, orderId: result.insertedId.toString(), total, walletBalance: newBal });
  } catch (err) {
    console.error('Error placing order:', err);
    res.status(500).json({ error: 'Failed to place order' });
  }
};

// 32. GET /api/orders
const getOrders = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const orders = await db.collection('orders').find({ user_id: user._id })
      .sort({ order_date: -1 }).toArray();

    res.json({ orders: (orders || []).map(o => ({ ...o, _id: o._id.toString() })) });
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// 33. POST /api/orders/:id/cancel
const cancelOrder = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  const orderId = req.params.id;
  if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: 'Invalid order ID' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId), user_id: user._id });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (['delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: `Cannot cancel ${order.status} order` });
    }

    // Refund wallet
    await db.collection('user_balances').updateOne({ user_id: user._id }, { $inc: { wallet_balance: order.total } });
    // Restore product availability
    for (const item of order.items) {
      await db.collection('products').updateOne({ _id: item.product_id }, { $inc: { availability: item.quantity } });
    }
    // Update order status
    await db.collection('orders').updateOne({ _id: new ObjectId(orderId) }, {
      $set: { status: 'cancelled' },
      $push: { tracking: { status: 'cancelled', date: new Date(), note: 'Order cancelled by player' } }
    });

    const newBal = (await db.collection('user_balances').findOne({ user_id: user._id }))?.wallet_balance || 0;
    res.json({ success: true, walletBalance: newBal });
  } catch (err) {
    console.error('Error cancelling order:', err);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
};

// 34. GET /api/orders/:id/tracking
const getOrderTracking = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  const orderId = req.params.id;
  if (!orderId || !ObjectId.isValid(orderId)) return res.status(400).json({ error: 'Invalid order ID' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId), user_id: user._id });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.json({
      orderId: order._id.toString(), status: order.status,
      tracking: order.tracking || [], estimated_delivery: order.estimated_delivery,
      items: order.items, total: order.total, order_date: order.order_date
    });
  } catch (err) {
    console.error('Error fetching tracking:', err);
    res.status(500).json({ error: 'Failed to fetch tracking' });
  }
};

// ===================== SUBSCRIPTION HISTORY =====================

// 35. GET /api/subscription/history
const getSubscriptionHistory = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const history = await db.collection('subscription_history')
      .find({ email: req.session.userEmail }).sort({ date: -1 }).toArray();
    const current = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
    res.json({ history: (history || []).map(h => ({ ...h, _id: h._id.toString() })), current });
  } catch (err) {
    console.error('Error fetching subscription history:', err);
    res.status(500).json({ error: 'Failed to fetch subscription history' });
  }
};

// 36. POST /api/subscription/change (upgrade/downgrade)
const changeSubscription = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  const { newPlan, newPrice } = req.body;
  if (!newPlan || !newPrice) return res.status(400).json({ error: 'Plan and price required' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const currentSub = await db.collection('subscriptionstable').findOne({ username: req.session.userEmail });
    if (!currentSub) return res.status(400).json({ error: 'No active subscription to change' });

    const priceDiff = parseFloat(newPrice) - (currentSub.price || 0);
    if (priceDiff > 0) {
      // Upgrade: charge difference
      const balDoc = await db.collection('user_balances').findOne({ user_id: user._id });
      const walletBalance = balDoc?.wallet_balance || 0;
      if (walletBalance < priceDiff) return res.status(400).json({ error: 'Insufficient balance for upgrade' });
      await db.collection('user_balances').updateOne({ user_id: user._id }, { $inc: { wallet_balance: -priceDiff } });
    } else if (priceDiff < 0) {
      // Downgrade: refund difference
      await db.collection('user_balances').updateOne({ user_id: user._id }, { $inc: { wallet_balance: Math.abs(priceDiff) } });
    }

    // Record history
    await db.collection('subscription_history').insertOne({
      email: req.session.userEmail, oldPlan: currentSub.plan, newPlan,
      oldPrice: currentSub.price, newPrice: parseFloat(newPrice),
      action: priceDiff > 0 ? 'upgrade' : 'downgrade', date: new Date()
    });

    // Update subscription
    await db.collection('subscriptionstable').updateOne({ username: req.session.userEmail }, {
      $set: { plan: newPlan, price: parseFloat(newPrice), changed_date: new Date() }
    });

    const newBal = (await db.collection('user_balances').findOne({ user_id: user._id }))?.wallet_balance || 0;
    res.json({ success: true, message: `Subscription changed to ${newPlan}`, walletBalance: newBal });
  } catch (err) {
    console.error('Error changing subscription:', err);
    res.status(500).json({ error: 'Failed to change subscription' });
  }
};

// ===================== PLAYER SETTINGS =====================

// 37. GET /api/settings
const getPlayerSettings = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const settings = await db.collection('player_settings').findOne({ user_id: user._id }) || {};
    res.json({
      wallpaper: settings.wallpaper || 'default',
      pieceStyle: settings.pieceStyle || 'standard',
      theme: settings.theme || 'dark',
      notifications: settings.notifications !== false,
      boardColor: settings.boardColor || 'green',
      isDeactivated: !!user.isDeactivated
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
};

// 38. PUT /api/settings
const updatePlayerSettings = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    const { wallpaper, pieceStyle, theme, notifications, boardColor } = req.body;
    const update = {};
    if (wallpaper !== undefined) update.wallpaper = wallpaper;
    if (pieceStyle !== undefined) update.pieceStyle = pieceStyle;
    if (theme !== undefined) update.theme = theme;
    if (notifications !== undefined) update.notifications = !!notifications;
    if (boardColor !== undefined) update.boardColor = boardColor;

    await db.collection('player_settings').updateOne(
      { user_id: user._id },
      { $set: { ...update, updated_date: new Date() } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
};

// ===================== ACCOUNT MANAGEMENT =====================

// 39. POST /api/deactivateAccount
const deactivateAccount = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player' });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    await db.collection('users').updateOne({ _id: user._id }, {
      $set: { isDeactivated: true, deactivated_date: new Date() }
    });

    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Account deactivated. You can reactivate by logging in again.' });
    });
  } catch (err) {
    console.error('Error deactivating account:', err);
    res.status(500).json({ error: 'Failed to deactivate account' });
  }
};

// ===================== CHAT IMAGE/GIF UPLOAD =====================

// 40. POST /api/chat/upload
const uploadChatImage = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field name "media".' });
  try {
    const result = await uploadImageBuffer(req.file.buffer, {
      folder: 'chesshive/chat-media',
      resource_type: 'auto'
    });
    if (!result?.secure_url) return res.status(500).json({ error: 'Upload failed' });
    res.json({ success: true, url: result.secure_url, type: req.file.mimetype });
  } catch (err) {
    console.error('Error uploading chat media:', err);
    res.status(500).json({ error: 'Failed to upload media' });
  }
};

// Multer middleware for chat media upload
const uploadChatMediaMiddleware = (req, res, next) => {
  if (!multer) return res.status(500).json({ error: 'Upload support not available' });
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (r, file, cb) => {
      const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes((file.mimetype || '').toLowerCase());
      if (!ok) return cb(new Error('Only image/GIF files allowed'));
      cb(null, true);
    }
  }).single('media');
  uploader(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
};

// ===================== STORE SUGGESTIONS =====================

// 41. GET /api/store/suggestions
const getStoreSuggestions = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const user = await db.collection('users').findOne({ email: req.session.userEmail, role: 'player', isDeleted: 0 });
    if (!user) return res.status(404).json({ error: 'Player not found' });

    // Get categories of previously purchased products
    const purchasedProducts = await db.collection('sales').aggregate([
      { $match: { buyer_id: user._id } },
      { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $group: { _id: '$product.category' } }
    ]).toArray();

    const purchasedCategories = purchasedProducts.map(p => p._id).filter(Boolean);
    const purchasedProductIds = (await db.collection('sales').find({ buyer_id: user._id }).toArray()).map(s => s.product_id);

    let suggestions;
    if (purchasedCategories.length > 0) {
      suggestions = await db.collection('products').find({
        category: { $in: purchasedCategories },
        _id: { $nin: purchasedProductIds },
        availability: { $gt: 0 }
      }).limit(6).toArray();
    } else {
      // Most ordered products overall
      const popular = await db.collection('sales').aggregate([
        { $group: { _id: '$product_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 6 },
        { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
        { $unwind: '$product' },
        { $match: { 'product.availability': { $gt: 0 } } }
      ]).toArray();
      suggestions = popular.map(p => p.product);
    }

    // Most ordered products
    const mostOrdered = await db.collection('sales').aggregate([
      { $group: { _id: '$product_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' }
    ]).toArray();

    res.json({
      suggestions: (suggestions || []).map(s => ({ ...s, _id: s._id.toString() })),
      mostOrdered: (mostOrdered || []).map(m => ({ ...m.product, _id: m.product._id.toString(), orderCount: m.count }))
    });
  } catch (err) {
    console.error('Error fetching suggestions:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
};

// ===================== DASHBOARD ENHANCEMENTS =====================

// 42. GET /api/news
const getNews = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const updates = await db.collection('platform_updates').find({}).sort({ date: -1 }).limit(10).toArray();
    const events = await db.collection('tournaments').find({ status: 'Approved' }).sort({ date: -1 }).limit(10).toArray();
    res.json({
      updates: (updates || []).map(u => ({ ...u, _id: u._id.toString() })),
      events: (events || []).map(e => ({ ...e, _id: e._id.toString() }))
    });
  } catch (err) {
    console.error('Error fetching news:', err);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
};

// 43. GET /api/tournament-calendar
const getTournamentCalendar = async (req, res) => {
  if (!req.session.userEmail) return res.status(401).json({ error: 'Please log in' });
  try {
    const db = await connectDB();
    const tournaments = await db.collection('tournaments').find({ status: 'Approved' }).toArray();
    const events = (tournaments || []).map(t => ({
      id: t._id.toString(), title: t.name, date: t.date, type: t.type || 'individual',
      location: t.location || '', entry_fee: t.entry_fee || 0,
      status: new Date(t.date) < new Date() ? 'completed' : new Date(t.date).toDateString() === new Date().toDateString() ? 'ongoing' : 'upcoming'
    }));
    res.json({ events });
  } catch (err) {
    console.error('Error fetching calendar:', err);
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
};

module.exports = {
  getDashboard,
  getTournaments,
  joinIndividual,
  joinTeam,
  getStore,
  getSubscription,
  getGrowth,
  getProfile,
  uploadPhoto,
  uploadPhotoMiddleware,
  updateProfile,
  deleteAccount,
  restorePlayer,
  comparePlayer,
  addFunds,
  getPairings,
  getRankings,
  getTeamPairings,
  getTeamRankings,
  approveTeamRequest,
  buyProduct,
  subscribePlan,
  getGrowthAnalytics,
  getNotifications,
  submitFeedback,
  markNotificationRead,
  getPlayerStreams,
  // New endpoints
  getCart,
  addToCart,
  removeFromCart,
  clearCart,
  placeOrder,
  getOrders,
  cancelOrder,
  getOrderTracking,
  getSubscriptionHistory,
  changeSubscription,
  getPlayerSettings,
  updatePlayerSettings,
  deactivateAccount,
  uploadChatImage,
  uploadChatMediaMiddleware,
  getStoreSuggestions,
  getNews,
  getTournamentCalendar
};
