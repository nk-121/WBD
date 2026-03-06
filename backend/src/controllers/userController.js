/**
 * UserController – handles generic user endpoints (cross-role).
 */
const { connectDB } = require('../config/database');
const UserModel = require('../models/UserModel');

const UserController = {
  /** GET /api/users?role=<role>  – search users by optional role filter */
  async getUsers(req, res) {
    try {
      const role = (req.query.role || '').toString().toLowerCase();
      const filter = role ? { role } : {};
      const db = await connectDB();
      const users = await UserModel.find(db, filter, {
        projection: { password: 0, mfaSecret: 0 },
        limit: 200
      });
      const list = users.map(u => ({
        id: u._id,
        username: u.name || u.username || u.email,
        email: u.email || null,
        role: u.role
      }));
      return res.json({ success: true, users: list });
    } catch (err) {
      console.error('UserController.getUsers error:', err);
      return res.status(500).json({ success: false, message: 'Unexpected server error' });
    }
  }
};

module.exports = UserController;
