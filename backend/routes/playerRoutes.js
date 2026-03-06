const express = require('express');
const router = express.Router();
const playerController = require('../controllers/playerController');

router.use(express.json());

// ==================== API ROUTES ====================

// Dashboard & Tournaments
router.get('/api/dashboard', playerController.getDashboard);
router.get('/api/tournaments', playerController.getTournaments);
router.post('/api/join-individual', playerController.joinIndividual);
router.post('/api/join-team', playerController.joinTeam);

// Store & Subscription
router.get('/api/store', playerController.getStore);
router.get('/api/subscription', playerController.getSubscription);

// Growth
router.get('/api/growth', playerController.getGrowth);
router.get('/api/growth_analytics', playerController.getGrowthAnalytics);

// Profile
router.get('/api/profile', playerController.getProfile);
router.post('/api/profile/photo', playerController.uploadPhoto);
router.put('/api/profile', playerController.updateProfile);
router.delete('/api/deleteAccount', playerController.deleteAccount);
router.post('/players/restore/:id', playerController.restorePlayer);

// Compare
router.get('/api/compare', playerController.comparePlayer);

// Funds
router.post('/api/add-funds', playerController.addFunds);

// Individual pairings & rankings
router.get('/api/pairings', playerController.getPairings);
router.get('/api/rankings', playerController.getRankings);

// Team pairings & rankings
router.get('/api/team-pairings', playerController.getTeamPairings);
router.get('/api/team-rankings', playerController.getTeamRankings);

// Team approval
router.post('/api/approve-team-request', playerController.approveTeamRequest);

// Store actions
router.post('/api/buy', playerController.buyProduct);
router.post('/api/subscribe', playerController.subscribePlan);

// Notifications
router.get('/api/notifications', playerController.getNotifications);
router.post('/api/mark-notification-read', playerController.markNotificationRead);

// Feedback
router.post('/api/submit-feedback', playerController.submitFeedback);

// Streams
router.get('/api/streams', playerController.getPlayerStreams);

// ==================== NEW FEATURE ROUTES ====================

// Cart
router.get('/api/cart', playerController.getCart);
router.post('/api/cart/add', playerController.addToCart);
router.delete('/api/cart/remove', playerController.removeFromCart);
router.delete('/api/cart/clear', playerController.clearCart);

// Orders
router.post('/api/orders', playerController.placeOrder);
router.get('/api/orders', playerController.getOrders);
router.post('/api/orders/:id/cancel', playerController.cancelOrder);
router.get('/api/orders/:id/tracking', playerController.getOrderTracking);

// Subscription management
router.get('/api/subscription/history', playerController.getSubscriptionHistory);
router.post('/api/subscription/change', playerController.changeSubscription);

// Player settings
router.get('/api/settings', playerController.getPlayerSettings);
router.put('/api/settings', playerController.updatePlayerSettings);

// Account management
router.post('/api/deactivateAccount', playerController.deactivateAccount);

// Chat media upload
router.post('/api/chat/upload', playerController.uploadChatMediaMiddleware, playerController.uploadChatImage);

// Store suggestions
router.get('/api/store/suggestions', playerController.getStoreSuggestions);

// News & Events
router.get('/api/news', playerController.getNews);

// Tournament calendar
router.get('/api/tournament-calendar', playerController.getTournamentCalendar);

module.exports = router;
