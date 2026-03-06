import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAsOrganizer } from '../../utils/fetchWithRole';
import '../../styles/playerNeoNoir.css';
import { motion } from 'framer-motion';
import usePlayerTheme from '../../hooks/usePlayerTheme';
import AnimatedSidebar from '../../components/AnimatedSidebar';
import { organizerLinks } from '../../constants/organizerLinks';

const PAGE_SIZE = 5;

const sectionVariants = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: i * 0.12,
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1]
    }
  })
};

function CoordinatorManagement() {
  const [isDark, toggleTheme] = usePlayerTheme();
  const [coordinators, setCoordinators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | removed

  const fetchCoordinators = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetchAsOrganizer('/organizer/api/coordinators');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch coordinators');
      const list = Array.isArray(data) ? data : [];
      setCoordinators(list);
      setVisible(PAGE_SIZE);
    } catch (e) {
      console.error('Fetch coordinators error:', e);
      setError('Failed to load coordinators.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoordinators();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return coordinators.filter((c) => {
      const matchesText = !q || [c.name, c.email, c.college, c.team].some((v) => (v || '').toLowerCase().includes(q));
      const isDeleted = !!c.isDeleted;
      const matchesStatus =
        statusFilter === 'all' || (statusFilter === 'active' && !isDeleted) || (statusFilter === 'removed' && isDeleted);
      return matchesText && matchesStatus;
    });
  }, [coordinators, query, statusFilter]);
  const isSelfDeleted = (user) => {
    const email = String(user?.email || '').trim().toLowerCase();
    const deletedBy = String(user?.deleted_by || '').trim().toLowerCase();
    return Boolean(email && deletedBy && email === deletedBy);
  };

  const onRemove = async (email) => {
    if (!window.confirm(`Are you sure you want to remove ${email}?`)) return;
    try {
      const res = await fetchAsOrganizer(`/organizer/api/coordinators/${encodeURIComponent(email)}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to remove coordinator');
      // update locally
      setCoordinators((prev) => prev.map((c) => (c.email === email ? { ...c, isDeleted: true } : c)));
      alert('Coordinator removed successfully.');
    } catch (e) {
      console.error('Remove error:', e);
      alert('Failed to remove coordinator.');
    }
  };

  const onRestore = async (email) => {
    if (!window.confirm(`Are you sure you want to restore ${email}?`)) return;
    try {
      const res = await fetchAsOrganizer(`/organizer/api/coordinators/restore/${encodeURIComponent(email)}`, {
        method: 'PATCH'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to restore coordinator');
      setCoordinators((prev) => prev.map((c) => (c.email === email ? { ...c, isDeleted: false } : c)));
      alert(data?.message || 'Coordinator restored successfully.');
    } catch (e) {
      console.error('Restore error:', e);
      alert(e.message || 'Failed to restore coordinator.');
    }
  };

  const visibleRows = filtered.slice(0, visible);

  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{`
        * { margin:0; padding:0; box-sizing:border-box; }
        body, #root { min-height: 100vh; }
        .page { font-family: 'Playfair Display', serif; background-color: var(--page-bg); min-height: 100vh; display:flex; color: var(--text-color); }
        .content { flex-grow:1; margin-left:0; padding:2rem; }
        h1 { font-family:'Cinzel', serif; color:var(--sea-green); margin-bottom:2rem; font-size:2.5rem; display:flex; align-items:center; gap:1rem; }
        .updates-section { background:var(--card-bg); border-radius:15px; padding:2rem; margin-bottom:2rem; box-shadow:none; border:1px solid var(--card-border); transition: transform 0.3s ease; }
        .updates-section:hover { transform: translateY(-5px); }
        .table { width:100%; border-collapse:collapse; margin-bottom:1rem; }
        .th { background:var(--sea-green); color:var(--on-accent); padding:1.2rem; text-align:left; font-family:'Cinzel', serif; font-size:1.1rem; }
        .td { padding:1rem; border-bottom:1px solid rgba(var(--sea-green-rgb, 27, 94, 63), 0.2); }
        .search-row { display:flex; align-items:center; gap:10px; padding:10px; background:var(--card-bg); border-radius:10px; box-shadow:0 2px 6px rgba(0,0,0,0.1); max-width:500px; margin:0 auto 20px; border:1px solid var(--card-border); }
        .input { flex:1; padding:10px 14px; border-radius:8px; border:1px solid var(--card-border); font-size:16px; background:var(--page-bg); color:var(--text-color); min-width:300px; }
        .select { padding:8px 12px; border-radius:8px; border:1px solid var(--card-border); font-size:14px; background:var(--page-bg); color:var(--text-color); }
        .more-btn { display:inline-flex; align-items:center; gap:0.5rem; background-color:var(--sea-green); color:var(--on-accent); text-decoration:none; padding:0.8rem 1.5rem; border-radius:8px; font-family:'Cinzel', serif; font-weight:bold; cursor:pointer; border:none; }
        .row-counter { text-align:center; margin-bottom:1rem; font-family:'Cinzel', serif; font-size:1.2rem; color:var(--sea-green); background-color:rgba(var(--sea-green-rgb, 27, 94, 63), 0.1); padding:0.5rem 1rem; border-radius:8px; display:inline-block; }
        .empty { text-align:center; padding:2rem; color:var(--sea-green); font-style:italic; }
        .remove-btn { background-color:#ff6b6b; color:#fff; border:none; padding:0.6rem 1rem; border-radius:5px; cursor:pointer; font-family:'Cinzel', serif; font-weight:bold; }
        .restore-btn { background-color:var(--sea-green); color:var(--on-accent); border:none; padding:0.6rem 1rem; border-radius:5px; cursor:pointer; font-family:'Cinzel', serif; font-weight:bold; }
        .locked-tag { color:#c62828; font-weight:bold; font-family:'Cinzel', serif; display:inline-flex; align-items:center; gap:0.4rem; }
        .back-link { display:inline-flex; align-items:center; gap:0.5rem; background:var(--sea-green); color:var(--on-accent); text-decoration:none; padding:0.8rem 1.5rem; border-radius:8px; font-family:'Cinzel', serif; font-weight:bold; }
      `}</style>

      <div className="page player-neo">
        <AnimatedSidebar links={organizerLinks} logo={<i className="fas fa-chess" />} title={`ChessHive`} />

        <div style={{ position: 'fixed', top: 18, right: 18, zIndex: 1001, display: 'flex', gap: '12px', alignItems: 'center' }}>
          <motion.button onClick={toggleTheme} className="more-btn" style={{ width: 40, height: 40, padding: 0, justifyContent: 'center' }}>
            <i className={isDark ? 'fas fa-sun' : 'fas fa-moon'} />
          </motion.button>
        </div>

        <div className="content">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <i className="fas fa-users-cog" /> Coordinator Management
          </motion.h1>

          <motion.div
            className="updates-section"
            custom={0}
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
              <div className="row-counter">
                {Math.min(visibleRows.length, filtered.length)} / {filtered.length}
              </div>
            </div>
            <div className="search-row">
              <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="removed">Removed</option>
              </select>
              <input className="input" placeholder="Search name, email or college…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>

            {loading && <div className="empty">Loading...</div>}
            {!loading && !!error && <div className="empty">{error}</div>}

            {!loading && !error && (
              <table className="table">
                <thead>
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Email</th>
                    <th className="th">Assigned Team/College</th>
                    <th className="th">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 && (
                    <tr><td className="td" colSpan={4}><div className="empty">No coordinators found.</div></td></tr>
                  )}
                  {visibleRows.map((c, idx) => (
                    <tr key={c.email || idx}>
                      <td className="td">{c.name}</td>
                      <td className="td">{c.email}</td>
                      <td className="td">{c.team || c.college || 'Unassigned'}</td>
                      <td className="td">
                        {c.isDeleted ? (
                          isSelfDeleted(c) ? (
                            <span className="locked-tag">
                              <i className="fas fa-lock" /> Self deleted
                            </span>
                          ) : (
                            <button className="restore-btn" onClick={() => onRestore(c.email)}>
                              <i className="fas fa-user-plus" /> Restore
                            </button>
                          )
                        ) : (
                          <button className="remove-btn" onClick={() => onRemove(c.email)}>
                            <i className="fas fa-user-minus" /> Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ textAlign: 'center', margin: '1rem 0', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              {visible < filtered.length && (
                <button className="more-btn" onClick={() => setVisible((v) => Math.min(v + PAGE_SIZE, filtered.length))}>More</button>
              )}
            </div>

            <div style={{ textAlign: 'right', marginTop: '2rem' }}>
              <Link to="/organizer/organizer_dashboard" className="back-to-dashboard">
                <i className="fas fa-arrow-left" /> Back to Dashboard
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default CoordinatorManagement;
