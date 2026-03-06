/**
 * TournamentModel – MongoDB repository for the `tournaments` collection.
 */
const { ObjectId } = require('mongodb');

const TournamentModel = {
  /** Find all tournaments matching a filter. */
  findAll(db, filter = {}) {
    return db.collection('tournaments').find(filter).toArray();
  },

  /** Find a single tournament by id. */
  findById(db, id) {
    const oid = ObjectId.isValid(id) ? new ObjectId(id) : id;
    return db.collection('tournaments').findOne({ _id: oid });
  },

  /** Find one tournament with arbitrary filter. */
  findOne(db, filter) {
    return db.collection('tournaments').findOne(filter);
  },

  /** Create a new tournament. */
  create(db, data) {
    return db.collection('tournaments').insertOne({ ...data, createdAt: new Date() });
  },

  /** Update a single tournament by id. */
  updateById(db, id, update) {
    const oid = ObjectId.isValid(id) ? new ObjectId(id) : id;
    return db.collection('tournaments').updateOne({ _id: oid }, update);
  },

  /** Bulk-update status for an array of ObjectIds. */
  updateStatus(db, ids, status, extraFields = {}) {
    if (!ids || ids.length === 0) return Promise.resolve({ modifiedCount: 0 });
    return db.collection('tournaments').updateMany(
      { _id: { $in: ids } },
      { $set: { status, ...extraFields } }
    );
  },

  /** Delete a tournament by id. */
  deleteById(db, id) {
    const oid = ObjectId.isValid(id) ? new ObjectId(id) : id;
    return db.collection('tournaments').deleteOne({ _id: oid });
  }
};

module.exports = TournamentModel;
