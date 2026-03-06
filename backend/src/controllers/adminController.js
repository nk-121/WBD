const { connectDB } = require('../config/database');
const moment = require('moment');
const helpers = require('../utils/helpers');
const path = require('path');
const { sendContactStatusEmail } = require('../services/emailService');

const normalizeEmail = (value) => (value == null ? '' : String(value).trim().toLowerCase());
const isSelfDeletedUser = (user) => {
  const email = normalizeEmail(user?.email);
  const deletedBy = normalizeEmail(user?.deleted_by);
  return Boolean(email && deletedBy && email === deletedBy);
};
const CONTACT_STATUSES = ['pending', 'new', 'in_progress', 'resolved', 'spam'];
const toDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const normalizeMonthKey = (value) => {
  const date = toDateOrNull(value);
  if (!date) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};
const inferCreatedDate = (doc, preferredFields = []) => {
  for (const field of preferredFields) {
    const value = doc?.[field];
    if (!value) continue;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (doc?._id && typeof doc._id.getTimestamp === 'function') {
    const d = doc._id.getTimestamp();
    if (!Number.isNaN(new Date(d).getTime())) return d;
  }
  return null;
};
const getRangeConfig = (rangeRaw) => {
  const range = String(rangeRaw || '30d').toLowerCase();
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  let granularity = 'day';
  switch (range) {
    case '7d':
      start.setDate(start.getDate() - 6);
      granularity = 'day';
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      granularity = 'day';
      break;
    case '6m':
      start.setMonth(start.getMonth() - 5);
      start.setDate(1);
      granularity = 'month';
      break;
    case '1y':
      start.setMonth(start.getMonth() - 11);
      start.setDate(1);
      granularity = 'month';
      break;
    default:
      start.setDate(start.getDate() - 29);
      granularity = 'day';
      break;
  }
  start.setHours(0, 0, 0, 0);
  return { range, start, end, granularity };
};
const toBucketKey = (date, granularity) => {
  const d = new Date(date);
  if (granularity === 'month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toBucketLabel = (date, granularity) => {
  const d = new Date(date);
  if (granularity === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
};
const buildBuckets = (start, end, granularity) => {
  const buckets = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    buckets.push({
      key: toBucketKey(cursor, granularity),
      label: toBucketLabel(cursor, granularity)
    });
    if (granularity === 'month') cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
};

// Admin dashboard API
const getDashboard = async (req, res) => {
  try {
    const db = await connectDB();
    const adminName = req.session.username || 'Admin';
    const threeDaysLater = moment().add(3, 'days').toDate();

    // Calculate Revenue
    // 1. Product Sales
    const productSalesTotal = await db.collection('sales').aggregate([
      { 
        $project: { 
          priceVal: { 
            $cond: [ 
              { $isNumber: '$price' }, 
              '$price', 
              { $toDouble: '$price' } 
            ] 
          } 
        } 
      },
      { $group: { _id: null, total: { $sum: '$priceVal' } } }
    ]).toArray();


    // 2. Individual Tournament Revenue
    const indTournaments = await db.collection('tournaments').aggregate([
      { $match: { type: 'Individual' } },
      { $lookup: { from: 'tournament_players', localField: '_id', foreignField: 'tournament_id', as: 'players' } },
      { $project: { revenue: { $multiply: [{ $ifNull: ['$entry_fee', 0] }, { $size: '$players' }] } } },
      { $group: { _id: null, total: { $sum: '$revenue' } } }
    ]).toArray();


    // 3. Team Tournament Revenue
    const teamTournaments = await db.collection('tournaments').aggregate([
      { $match: { type: 'Team' } },
      { $lookup: { from: 'enrolledtournaments_team', localField: '_id', foreignField: 'tournament_id', as: 'teams' } },
      {
        $project: {
          approved_teams: {
            $filter: {
              input: '$teams',
              as: 'team',
              cond: { $eq: ['$$team.approved', 1] }
            }
          },
          entry_fee: 1
        }
      },
      { $project: { revenue: { $multiply: [{ $ifNull: ['$entry_fee', 0] }, { $size: '$approved_teams' }] } } },
      { $group: { _id: null, total: { $sum: '$revenue' } } }
    ]).toArray();


    // 4. Counts
    const [
      playerCount,
      organizerCount,
      coordinatorCount,
      tournamentCount
    ] = await Promise.all([
      db.collection('users').countDocuments({ role: 'player', isDeleted: { $ne: 1 } }),
      db.collection('users').countDocuments({ role: 'organizer', isDeleted: { $ne: 1 } }),
      db.collection('users').countDocuments({ role: 'coordinator', isDeleted: { $ne: 1 } }),
      db.collection('tournaments').countDocuments({ status: { $ne: 'Removed' } })
    ]);

    // 5. Total Revenue aggregation
    const finalRevenue = (productSalesTotal[0]?.total || 0) + (indTournaments[0]?.total || 0) + (teamTournaments[0]?.total || 0);

    const meetings = await db.collection('meetingsdb')
      .find({ role: 'admin', date: { $lte: threeDaysLater } })
      .sort({ date: 1, time: 1 })
      .toArray();

    const contactMessages = await db.collection('contact')
      .find()
      .sort({ submission_date: -1 })
      .toArray();

    res.json({
      adminName,
      stats: {
        players: playerCount,
        organizers: organizerCount,
        coordinators: coordinatorCount,
        tournaments: tournamentCount,
        revenue: finalRevenue
      },
      meetings: meetings || [],
      contactMessages: contactMessages || []
    });
  } catch (error) {
    console.error('Error fetching admin dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};

const getContactMessages = async (req, res) => {
  try {
    const db = await connectDB();
    const status = (req.query.status || '').toString().trim().toLowerCase();
    const search = (req.query.search || '').toString().trim();
    const filter = {};

    if (CONTACT_STATUSES.includes(status)) {
      filter.status = status;
    }
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { message: rx }];
    }

    const messages = await db.collection('contact')
      .find(filter)
      .sort({ submission_date: -1 })
      .toArray();

    return res.json({ messages });
  } catch (error) {
    console.error('Error fetching contact messages:', error);
    return res.status(500).json({ error: 'Failed to fetch contact messages' });
  }
};

const updateContactMessageStatus = async (req, res) => {
  try {
    const { id } = req.params;
    let incomingStatus = (req.body?.status || '').toString().trim().toLowerCase();
    if (incomingStatus === 'new') incomingStatus = 'pending';
    const internalNote = (req.body?.internal_note || '').toString().trim();

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    if (!CONTACT_STATUSES.includes(incomingStatus)) {
      return res.status(400).json({ error: `Invalid status. Use one of: ${CONTACT_STATUSES.join(', ')}` });
    }

    const db = await connectDB();
    const update = {
      status: incomingStatus,
      internal_note: internalNote,
      status_updated_at: new Date(),
      status_updated_by: req.session.userEmail || 'admin'
    };
    if (incomingStatus === 'resolved') {
      update.resolved_at = new Date();
    }

    const result = await db.collection('contact').updateOne(
      { _id: new ObjectId(id) },
      { $set: update }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const updated = await db.collection('contact').findOne({ _id: new ObjectId(id) });
    let emailDelivery = { attempted: false, sent: false };
    if (updated?.email) {
      emailDelivery.attempted = true;
      try {
        const mailResult = await sendContactStatusEmail(updated.email, {
          status: incomingStatus,
          adminMessage: internalNote,
          userMessage: updated.message
        });
        emailDelivery = { ...emailDelivery, ...(mailResult || {}) };
      } catch (mailErr) {
        console.error('Failed to send contact status notification email:', mailErr);
      }
    }
    return res.json({ success: true, message: updated, emailDelivery });
  } catch (error) {
    console.error('Error updating contact message status:', error);
    return res.status(500).json({ error: 'Failed to update message status' });
  }
};

// Tournaments API (for admin to view all)
const getTournaments = async (req, res) => {
  try {
    const db = await connectDB();
    const tournaments = await db.collection('tournaments')
      .find({ status: { $ne: 'Removed' } })
      .sort({ date: -1 })
      .toArray();

    // Get all tournament IDs
    const tournamentIds = tournaments.map(t => t._id);

    // Fetch individual enrollments
    const individualCounts = await db.collection('tournament_players').aggregate([
      { $match: { tournament_id: { $in: tournamentIds } } },
      { $group: { _id: '$tournament_id', count: { $sum: 1 } } }
    ]).toArray();

    // Fetch team enrollments
    const teamCounts = await db.collection('enrolledtournaments_team').aggregate([
      { $match: { 
        tournament_id: { $in: tournamentIds },
        approved: 1
      } },
      { $group: { _id: '$tournament_id', count: { $sum: 1 } } },
      { $project: { count: { $multiply: ['$count', 3] } } }
    ]).toArray();

    // Create maps for quick lookup
    const individualMap = {};
    individualCounts.forEach(item => {
      individualMap[item._id.toString()] = item.count || 0;
    });

    const teamMap = {};
    teamCounts.forEach(item => {
      teamMap[item._id.toString()] = item.count || 0;
    });

    // Add player_count to each tournament
    const tournamentsWithCounts = tournaments.map(tournament => {
      const indCount = individualMap[tournament._id.toString()] || 0;
      const teamCount = teamMap[tournament._id.toString()] || 0;
      return {
        ...tournament,
        player_count: indCount + teamCount
      };
    });

    res.json({ tournaments: tournamentsWithCounts });
  } catch (error) {
    console.error('Error fetching tournaments:', error);
    res.status(500).json({ error: 'Failed to fetch tournaments' });
  }
};

// Remove Tournament API (for admin)
const removeTournament = async (req, res) => {
  try {
    const id = req.params.id;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const result = await db.collection('tournaments').updateOne(
      { _id: new ObjectId(id), status: { $ne: 'Removed' } },
      { $set: { status: 'Removed', removed_date: new Date(), removed_by: req.session.userEmail } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Tournament removed successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Tournament not found' });
    }
  } catch (error) {
    console.error('Error removing tournament:', error);
    res.status(500).json({ success: false, error: 'Failed to remove tournament' });
  }
};

// Coordinators API
const getCoordinators = async (req, res) => {
  try {
    const db = await connectDB();
    const coordinators = await db.collection('users')
      .find({ role: 'coordinator' })
      .project({ name: 1, email: 1, college: 1, isDeleted: 1, deleted_by: 1 })
      .toArray();

    res.json(coordinators);
  } catch (error) {
    console.error('Error fetching coordinators:', error);
    res.status(500).json({ error: 'Failed to fetch coordinators' });
  }
};

// Remove Coordinator API
const removeCoordinator = async (req, res) => {
  try {
    const { email } = req.params;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const result = await db.collection('users').updateOne(
      { email: email, role: 'coordinator', isDeleted: { $ne: 1 } },
      { $set: { isDeleted: 1, deleted_date: new Date(), deleted_by: req.session.userEmail } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Coordinator removed successfully' });
    } else {
      res.status(404).json({ error: 'Coordinator not found' });
    }
  } catch (error) {
    console.error('Error removing coordinator:', error);
    res.status(500).json({ error: 'Failed to remove coordinator' });
  }
};

// Restore Coordinator API
const restoreCoordinator = async (req, res) => {
  try {
    const { email } = req.params;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const coordinator = await db.collection('users').findOne({
      email: email,
      role: 'coordinator',
      isDeleted: 1
    });
    if (!coordinator) {
      return res.status(404).json({ error: 'Coordinator not found or already restored' });
    }
    if (isSelfDeletedUser(coordinator)) {
      return res.status(403).json({ error: 'Self-deleted accounts cannot be restored by others' });
    }

    const result = await db.collection('users').updateOne(
      { _id: coordinator._id },
      {
        $set: { isDeleted: 0, restored_date: new Date(), restored_by: req.session.userEmail },
        $unset: { deleted_date: '', deleted_by: '' }
      }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Coordinator restored successfully' });
    } else {
      res.status(404).json({ error: 'Coordinator not found or already restored' });
    }
  } catch (error) {
    console.error('Error restoring coordinator:', error);
    res.status(500).json({ error: 'Failed to restore coordinator' });
  }
};

// Organizers API
const getOrganizers = async (req, res) => {
  try {
    const db = await connectDB();
    const organizers = await db.collection('users')
      .find({ role: 'organizer' })
      .project({ name: 1, email: 1, college: 1, isDeleted: 1, deleted_by: 1 })
      .toArray();

    res.json(organizers);
  } catch (error) {
    console.error('Error fetching organizers:', error);
    res.status(500).json({ error: 'Failed to fetch organizers' });
  }
};

// Remove Organizer API
const removeOrganizer = async (req, res) => {
  try {
    const { email } = req.params;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const result = await db.collection('users').updateOne(
      { email: email, role: 'organizer', isDeleted: { $ne: 1 } },
      { $set: { isDeleted: 1, deleted_date: new Date(), deleted_by: req.session.userEmail } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Organizer removed successfully' });
    } else {
      res.status(404).json({ error: 'Organizer not found' });
    }
  } catch (error) {
    console.error('Error removing organizer:', error);
    res.status(500).json({ error: 'Failed to remove organizer' });
  }
};

// Restore Organizer API
const restoreOrganizer = async (req, res) => {
  try {
    const { email } = req.params;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const organizer = await db.collection('users').findOne({
      email: email,
      role: 'organizer',
      isDeleted: 1
    });
    if (!organizer) {
      return res.status(404).json({ error: 'Organizer not found or already restored' });
    }
    if (isSelfDeletedUser(organizer)) {
      return res.status(403).json({ error: 'Self-deleted accounts cannot be restored by others' });
    }

    const result = await db.collection('users').updateOne(
      { _id: organizer._id },
      {
        $set: { isDeleted: 0, restored_date: new Date(), restored_by: req.session.userEmail },
        $unset: { deleted_date: '', deleted_by: '' }
      }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Organizer restored successfully' });
    } else {
      res.status(404).json({ error: 'Organizer not found or already restored' });
    }
  } catch (error) {
    console.error('Error restoring organizer:', error);
    res.status(500).json({ error: 'Failed to restore organizer' });
  }
};

// Players API
const getPlayers = async (req, res) => {
  try {
    const db = await connectDB();
    const players = await db.collection('users')
      .find({ role: 'player' })
      .project({ name: 1, email: 1, college: 1, isDeleted: 1, deleted_by: 1 })
      .toArray();

    // Fetch products bought by each player
    const playersWithProducts = await Promise.all(players.map(async (player) => {
      const sales = await db.collection('sales').find({
        $or: [
          { buyer_id: player._id },
          { buyer: player.name },
          { buyer: player.email }
        ]
      }).toArray();

      const productMap = new Map();
      let totalSpent = 0;

      for (const s of sales) {
        const quantity = Math.max(1, Number(s?.quantity || 1));
        const saleTotal = Number(s?.price || 0);
        if (Number.isFinite(saleTotal)) totalSpent += saleTotal;

        let productName = s?.product || s?.product_name || '';
        if (!productName && s?.product_id) {
          const p = await db.collection('products').findOne({ _id: s.product_id }, { projection: { name: 1 } });
          productName = p?.name || 'Unknown Product';
        }
        if (!productName) productName = 'Unknown Product';

        const key = `${productName}`;
        if (!productMap.has(key)) {
          productMap.set(key, {
            name: productName,
            quantity: 0,
            totalPrice: 0
          });
        }
        const row = productMap.get(key);
        row.quantity += quantity;
        row.totalPrice += saleTotal;
      }

      const boughtProductsDetailed = Array.from(productMap.values()).map((row) => ({
        ...row,
        unitPrice: row.quantity > 0 ? Number((row.totalPrice / row.quantity).toFixed(2)) : 0,
        totalPrice: Number(row.totalPrice.toFixed(2))
      })).sort((a, b) => b.totalPrice - a.totalPrice);

      return {
        ...player,
        boughtProducts: boughtProductsDetailed.map((p) => p.name),
        boughtProductsDetailed,
        totalSpent: Number(totalSpent.toFixed(2))
      };
    }));

    res.json(playersWithProducts);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
};

// Remove Player API
const removePlayer = async (req, res) => {
  try {
    const { email } = req.params;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const result = await db.collection('users').updateOne(
      { email: email, role: 'player', isDeleted: { $ne: 1 } },
      { $set: { isDeleted: 1, deleted_date: new Date(), deleted_by: req.session.userEmail } }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Player removed successfully' });
    } else {
      res.status(404).json({ error: 'Player not found' });
    }
  } catch (error) {
    console.error('Error removing player:', error);
    res.status(500).json({ error: 'Failed to remove player' });
  }
};

// Restore Player API
const restorePlayer = async (req, res) => {
  try {
    const { email } = req.params;

    // Auth check
    if (!req.session.userEmail || req.session.userRole !== 'admin') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const db = await connectDB();
    const player = await db.collection('users').findOne({
      email: email,
      role: 'player',
      isDeleted: 1
    });
    if (!player) {
      return res.status(404).json({ error: 'Player not found or already restored' });
    }
    if (isSelfDeletedUser(player)) {
      return res.status(403).json({ error: 'Self-deleted accounts cannot be restored by others' });
    }

    const result = await db.collection('users').updateOne(
      { _id: player._id },
      {
        $set: { isDeleted: 0, restored_date: new Date(), restored_by: req.session.userEmail },
        $unset: { deleted_date: '', deleted_by: '' }
      }
    );

    if (result.modifiedCount > 0) {
      res.json({ success: true, message: 'Player restored successfully' });
    } else {
      res.status(404).json({ error: 'Player not found or already restored' });
    }
  } catch (error) {
    console.error('Error restoring player:', error);
    res.status(500).json({ error: 'Failed to restore player' });
  }
};

// Payments API
const getPayments = async (req, res) => {
  try {
    const db = await connectDB();
    const startDate = toDateOrNull(req.query?.startDate);
    const endDate = toDateOrNull(req.query?.endDate);
    const college = (req.query?.college || '').toString().trim().toLowerCase();
    const coordinator = (req.query?.coordinator || '').toString().trim().toLowerCase();

    const players = await db.collection('subscriptionstable').aggregate([
      { $lookup: { from: 'users', localField: 'username', foreignField: 'email', as: 'user' } },
      { $unwind: '$user' },
      { $match: { 'user.isDeleted': 0 } },
      { $project: { name: '$user.name', plan: 1, start_date: 1 } }
    ]).toArray();

    const sales = await db.collection('sales').aggregate([
      { $lookup: { from: 'products', localField: 'product_id', foreignField: '_id', as: 'product' } },
      { $unwind: '$product' },
      { $project: { product: '$product.name', price: 1, coordinator: '$product.coordinator', college: 1, buyer: 1, purchase_date: 1 } }
    ]).toArray();

    const tournamentSales = await db.collection('tournaments').aggregate([
      {
        $lookup: { from: 'tournament_players', localField: '_id', foreignField: 'tournament_id', as: 'individual_enrollments' }
      },
      {
        $lookup: { from: 'enrolledtournaments_team', localField: '_id', foreignField: 'tournament_id', as: 'team_enrollments' }
      },
      {
        $project: {
          name: 1,
          entry_fee: 1,
          type: 1,
          date: 1,
          coordinator: 1,
          college: 1,
          individual_enrollments: { $size: '$individual_enrollments' },
          team_enrollments: { $size: { $filter: { input: '$team_enrollments', as: 'team', cond: { $eq: ['$$team.approved', 1] } } } }
        }
      },
      {
        $facet: {
          individual: [
            { $match: { type: 'Individual', individual_enrollments: { $gt: 0 } } },
            { $project: { name: 1, entry_fee: 1, type: 1, coordinator: 1, college: 1, total_enrollments: '$individual_enrollments', revenue: { $multiply: ['$entry_fee', '$individual_enrollments'] }, enrollment_date: '$date' } }
          ],
          team: [
            { $match: { type: 'Team', team_enrollments: { $gt: 0 } } },
            { $unwind: '$team_enrollments' },
            { $match: { 'team_enrollments.approved': 1 } },
            {
              $group: {
                _id: '$_id',
                name: { $first: '$name' },
                entry_fee: { $first: '$entry_fee' },
                type: { $first: '$type' },
                coordinator: { $first: '$coordinator' },
                college: { $first: '$college' },
                total_enrollments: { $sum: 1 },
                enrollment_dates: { $push: '$team_enrollments.enrollment_date' }
              }
            },
            { $project: { name: 1, entry_fee: 1, type: 1, coordinator: 1, college: 1, total_enrollments: 1, revenue: { $multiply: ['$entry_fee', '$total_enrollments'] }, enrollment_date: { $arrayElemAt: ['$enrollment_dates', 0] } } }
          ]
        }
      },
      { $project: { combined: { $concatArrays: ['$individual', '$team'] } } },
      { $unwind: '$combined' },
      { $replaceRoot: { newRoot: '$combined' } },
      { $sort: { enrollment_date: -1 } }
    ]).toArray();

    const inDateRange = (dateValue) => {
      const d = toDateOrNull(dateValue);
      if (!d) return false;
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    };

    const filteredSales = sales.filter((row) => {
      const collegeOk = !college || String(row?.college || '').toLowerCase().includes(college);
      const coordinatorOk = !coordinator || String(row?.coordinator || '').toLowerCase().includes(coordinator);
      const dateOk = (!startDate && !endDate) ? true : inDateRange(row?.purchase_date);
      return collegeOk && coordinatorOk && dateOk;
    });

    const filteredTournamentSales = tournamentSales.filter((row) => {
      const collegeOk = !college || String(row?.college || '').toLowerCase().includes(college);
      const coordinatorOk = !coordinator || String(row?.coordinator || '').toLowerCase().includes(coordinator);
      const dateOk = (!startDate && !endDate) ? true : inDateRange(row?.enrollment_date);
      return collegeOk && coordinatorOk && dateOk;
    });

    const salesByCollegeMap = {};
    const salesByCoordinatorMap = {};
    const monthlyStoreRevenueMap = {};
    const monthlyTournamentRevenueMap = {};

    filteredSales.forEach((s) => {
      const collegeKey = String(s?.college || 'Unknown');
      const coordinatorKey = String(s?.coordinator || 'Unknown');
      const price = Number(s?.price || 0);
      const monthKey = normalizeMonthKey(s?.purchase_date);

      if (!salesByCollegeMap[collegeKey]) salesByCollegeMap[collegeKey] = { college: collegeKey, orders: 0, revenue: 0 };
      if (!salesByCoordinatorMap[coordinatorKey]) salesByCoordinatorMap[coordinatorKey] = { coordinator: coordinatorKey, orders: 0, revenue: 0 };
      salesByCollegeMap[collegeKey].orders += 1;
      salesByCollegeMap[collegeKey].revenue += price;
      salesByCoordinatorMap[coordinatorKey].orders += 1;
      salesByCoordinatorMap[coordinatorKey].revenue += price;
      if (monthKey) monthlyStoreRevenueMap[monthKey] = Number(monthlyStoreRevenueMap[monthKey] || 0) + price;
    });

    filteredTournamentSales.forEach((t) => {
      const monthKey = normalizeMonthKey(t?.enrollment_date);
      const revenue = Number(t?.revenue || 0);
      if (monthKey) monthlyTournamentRevenueMap[monthKey] = Number(monthlyTournamentRevenueMap[monthKey] || 0) + revenue;
    });

    const analytics = {
      totals: {
        salesCount: filteredSales.length,
        storeRevenue: filteredSales.reduce((sum, row) => sum + Number(row?.price || 0), 0),
        tournamentEnrollments: filteredTournamentSales.reduce((sum, row) => sum + Number(row?.total_enrollments || 0), 0),
        tournamentRevenue: filteredTournamentSales.reduce((sum, row) => sum + Number(row?.revenue || 0), 0)
      },
      salesByCollege: Object.values(salesByCollegeMap).sort((a, b) => b.revenue - a.revenue),
      salesByCoordinator: Object.values(salesByCoordinatorMap).sort((a, b) => b.revenue - a.revenue),
      monthlyStoreRevenue: Object.entries(monthlyStoreRevenueMap)
        .map(([month, revenue]) => ({ month, revenue }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      monthlyTournamentRevenue: Object.entries(monthlyTournamentRevenueMap)
        .map(([month, revenue]) => ({ month, revenue }))
        .sort((a, b) => a.month.localeCompare(b.month))
    };

    res.json({
      players,
      sales: filteredSales,
      tournamentSales: filteredTournamentSales,
      analytics,
      filtersApplied: {
        startDate: startDate || null,
        endDate: endDate || null,
        college: req.query?.college || '',
        coordinator: req.query?.coordinator || ''
      }
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments data' });
  }
};

const getOrganizerAnalytics = async (req, res) => {
  try {
    const db = await connectDB();
    const organizers = await db.collection('users')
      .find({ role: 'organizer', isDeleted: { $ne: 1 } })
      .project({ name: 1, email: 1, college: 1 })
      .toArray();

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const rows = [];
    for (const org of organizers) {
      const identityRegexes = [
        new RegExp(`^${String(org?.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        new RegExp(`^${String(org?.email || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      ];

      const approvedCount = await db.collection('tournaments').countDocuments({
        $or: [{ approved_by: { $in: [org?.name, org?.email] } }, { approved_by: { $in: identityRegexes } }],
        status: 'Approved'
      });
      const rejectedCount = await db.collection('tournaments').countDocuments({
        $or: [{ rejected_by: { $in: [org?.name, org?.email] } }, { rejected_by: { $in: identityRegexes } }],
        status: 'Rejected'
      });
      const meetingsScheduled = await db.collection('meetingsdb').countDocuments({
        role: 'organizer',
        $or: [{ name: org?.name }, { name: org?.email }, { name: { $in: identityRegexes } }]
      });

      const monthApprovedCurrent = await db.collection('tournaments').countDocuments({
        approved_date: { $gte: currentMonthStart },
        $or: [{ approved_by: org?.name }, { approved_by: org?.email }, { approved_by: { $in: identityRegexes } }]
      });
      const monthApprovedPrev = await db.collection('tournaments').countDocuments({
        approved_date: { $gte: prevMonthStart, $lte: prevMonthEnd },
        $or: [{ approved_by: org?.name }, { approved_by: org?.email }, { approved_by: { $in: identityRegexes } }]
      });
      const growthPercentage = monthApprovedPrev > 0
        ? Math.round(((monthApprovedCurrent - monthApprovedPrev) / monthApprovedPrev) * 100)
        : (monthApprovedCurrent > 0 ? 100 : 0);

      rows.push({
        name: org?.name || 'Organizer',
        email: org?.email || '',
        college: org?.college || '',
        approvedCount,
        rejectedCount,
        decisions: approvedCount + rejectedCount,
        meetingsScheduled,
        growthPercentage
      });
    }

    rows.sort((a, b) => b.decisions - a.decisions || b.approvedCount - a.approvedCount);
    rows.forEach((r, i) => { r.rank = i + 1; });

    const totals = rows.reduce((acc, row) => ({
      organizers: acc.organizers + 1,
      approvedCount: acc.approvedCount + row.approvedCount,
      rejectedCount: acc.rejectedCount + row.rejectedCount,
      meetingsScheduled: acc.meetingsScheduled + row.meetingsScheduled
    }), { organizers: 0, approvedCount: 0, rejectedCount: 0, meetingsScheduled: 0 });

    return res.json({ totals, organizers: rows });
  } catch (error) {
    console.error('Error fetching organizer analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch organizer analytics' });
  }
};

const getGrowthAnalytics = async (req, res) => {
  try {
    const db = await connectDB();
    const { range, start, end, granularity } = getRangeConfig(req.query?.range);
    const buckets = buildBuckets(start, end, granularity);
    const bucketMap = {};
    buckets.forEach((bucket) => {
      bucketMap[bucket.key] = {
        label: bucket.label,
        tournamentsCreated: 0,
        completedTournaments: 0,
        ongoingTournaments: 0,
        revenue: 0,
        transactions: 0
      };
    });

    const [users, sales, tournaments] = await Promise.all([
      db.collection('users').find({ isDeleted: { $ne: 1 } }).project({ role: 1 }).toArray(),
      db.collection('sales').find({}).project({ price: 1, purchase_date: 1, created_date: 1, created_at: 1, createdAt: 1 }).toArray(),
      db.collection('tournaments').find({ status: { $ne: 'Removed' } }).project({ status: 1, submitted_date: 1, created_date: 1, created_at: 1, added_date: 1 }).toArray()
    ]);

    tournaments.forEach((tournament) => {
      const created = inferCreatedDate(tournament, ['submitted_date', 'created_date', 'created_at', 'added_date']);
      if (!created || created < start || created > end) return;
      const key = toBucketKey(created, granularity);
      if (!bucketMap[key]) return;
      bucketMap[key].tournamentsCreated += 1;
      const status = String(tournament?.status || '').toLowerCase();
      if (status === 'completed') bucketMap[key].completedTournaments += 1;
      if (status === 'ongoing') bucketMap[key].ongoingTournaments += 1;
    });

    sales.forEach((sale) => {
      const purchaseDate = inferCreatedDate(sale, ['purchase_date', 'created_date', 'created_at', 'createdAt']);
      if (!purchaseDate || purchaseDate < start || purchaseDate > end) return;
      const key = toBucketKey(purchaseDate, granularity);
      if (!bucketMap[key]) return;
      bucketMap[key].revenue += Number(sale?.price || 0);
      bucketMap[key].transactions += 1;
    });

    const tournamentsTimeline = buckets.map((bucket) => ({
      label: bucket.label,
      totalCreated: bucketMap[bucket.key]?.tournamentsCreated || 0,
      completed: bucketMap[bucket.key]?.completedTournaments || 0,
      ongoing: bucketMap[bucket.key]?.ongoingTournaments || 0
    }));
    const salesTimeline = buckets.map((bucket) => ({
      label: bucket.label,
      revenue: Number((bucketMap[bucket.key]?.revenue || 0).toFixed(2)),
      transactions: bucketMap[bucket.key]?.transactions || 0
    }));

    const playersCount = users.filter((u) => u.role === 'player').length;
    const coordinatorsCount = users.filter((u) => u.role === 'coordinator').length;
    const organizersCount = users.filter((u) => u.role === 'organizer').length;
    const totalUsers = playersCount + coordinatorsCount + organizersCount;

    const summary = {
      totalRevenue: Number(salesTimeline.reduce((sum, row) => sum + Number(row.revenue || 0), 0).toFixed(2)),
      totalUsers,
      totalTournaments: tournamentsTimeline.reduce((sum, row) => sum + Number(row.totalCreated || 0), 0)
    };

    return res.json({
      range,
      granularity,
      summary,
      userTotals: {
        players: playersCount,
        coordinators: coordinatorsCount,
        organizers: organizersCount
      },
      tournamentsTimeline,
      salesTimeline
    });
  } catch (error) {
    console.error('Error fetching admin growth analytics:', error);
    return res.status(500).json({ error: 'Failed to fetch growth analytics' });
  }
};

module.exports = {
  getDashboard,
  getContactMessages,
  updateContactMessageStatus,
  getTournaments,
  removeTournament,
  getCoordinators,
  removeCoordinator,
  restoreCoordinator,
  getOrganizers,
  removeOrganizer,
  restoreOrganizer,
  getPlayers,
  removePlayer,
  restorePlayer,
  getPayments,
  getOrganizerAnalytics,
  getGrowthAnalytics
};
