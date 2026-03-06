import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/playerNeoNoir.css';
import { motion } from 'framer-motion';
import { fetchAsOrganizer } from '../../utils/fetchWithRole';
import usePlayerTheme from '../../hooks/usePlayerTheme';
import AnimatedSidebar from '../../components/AnimatedSidebar';
import { organizerLinks } from '../../constants/organizerLinks';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend);

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

const listVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.12 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
  }
};

function CoordinatorPerformance() {
  const [isDark, toggleTheme] = usePlayerTheme();
  const [coordinators, setCoordinators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');

  const loadPerformance = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetchAsOrganizer('/organizer/api/coordinator-performance');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load performance data');
      setCoordinators(Array.isArray(data) ? data : (data.coordinators || []));
    } catch (e) {
      console.error('Performance load error:', e);
      setError('Error loading coordinator performance data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPerformance();
  }, [loadPerformance]);

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(column);
      setSortDir('asc');
    }
  };

  const sortedCoordinators = useMemo(() => {
    const sorted = [...coordinators].sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      if (typeof aVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [coordinators, sortBy, sortDir]);

  // Chart data: top 10 coordinators by total revenue
  const chartData = useMemo(() => {
    const topCoordinators = [...coordinators]
      .sort((a, b) => (b.totalRevenue || 0) - (a.totalRevenue || 0))
      .slice(0, 10);
    return {
      labels: topCoordinators.map((c) => c.name || 'Unknown'),
      datasets: [
        {
          label: 'Total Revenue',
          data: topCoordinators.map((c) => c.totalRevenue || 0),
          backgroundColor: 'rgba(46, 139, 87, 0.7)',
          borderColor: '#2E8B57',
          borderWidth: 2,
          borderRadius: 6,
          hoverBackgroundColor: 'rgba(46, 139, 87, 0.9)'
        }
      ]
    };
  }, [coordinators]);

  const growthChartData = useMemo(() => {
    const topByGrowth = [...coordinators]
      .sort((a, b) => (b.growthPercentage || 0) - (a.growthPercentage || 0))
      .slice(0, 10);

    return {
      labels: topByGrowth.map((c) => c.name || 'Unknown'),
      datasets: [
        {
          label: 'Growth %',
          data: topByGrowth.map((c) => c.growthPercentage || 0),
          borderColor: '#F4B942',
          backgroundColor: 'rgba(244, 185, 66, 0.2)',
          fill: true,
          tension: 0.3
        }
      ]
    };
  }, [coordinators]);

  const collegeStats = useMemo(() => {
    const map = new Map();
    coordinators.forEach((coord) => {
      const collegeName = coord.college || 'Unassigned';
      if (!map.has(collegeName)) {
        map.set(collegeName, {
          college: collegeName,
          coordinators: 0,
          tournaments: 0,
          productsSold: 0,
          totalRevenue: 0
        });
      }
      const current = map.get(collegeName);
      current.coordinators += 1;
      current.tournaments += Number(coord.totalTournaments || 0);
      current.productsSold += Number(coord.totalProductsSold || 0);
      current.totalRevenue += Number(coord.totalRevenue || 0);
    });

    return [...map.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [coordinators]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: 'Top Coordinators by Revenue',
        color: '#2E8B57',
        font: { family: 'Cinzel, serif', size: 16, weight: 'bold' }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `Revenue: INR ${(ctx.raw ?? 0).toFixed(2)}`
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { color: '#2E8B57' },
        grid: { color: 'rgba(46,139,87,0.12)' }
      },
      x: {
        ticks: { color: '#2E8B57', maxRotation: 45 },
        grid: { color: 'rgba(46,139,87,0.12)' }
      }
    }
  };

  const growthChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: 'Performance Growth Trend (%)',
        color: '#2E8B57',
        font: { family: 'Cinzel, serif', size: 16, weight: 'bold' }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `Growth: ${(ctx.raw ?? 0).toFixed(2)}%`
        }
      }
    },
    scales: {
      y: {
        ticks: {
          color: '#2E8B57',
          callback: (v) => `${v}%`
        },
        grid: { color: 'rgba(46,139,87,0.12)' }
      },
      x: {
        ticks: { color: '#2E8B57', maxRotation: 45 },
        grid: { color: 'rgba(46,139,87,0.12)' }
      }
    }
  };

  const sortIcon = (col) => {
    if (sortBy !== col) return <i className="fas fa-sort" style={{ opacity: 0.3, marginLeft: 4 }} />;
    return <i className={`fas fa-sort-${sortDir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 4, color: 'var(--sea-green)' }} />;
  };

  const formatCurrency = (n) => `INR ${(n ?? 0).toFixed(2)}`;

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
        .updates-section h3 { font-family:'Cinzel', serif; color:var(--sea-green); margin-bottom:1.5rem; display:flex; align-items:center; gap:0.8rem; font-size:1.5rem; }
        .chart-wrapper { background:var(--card-bg); border-radius:15px; padding:1.5rem; margin-bottom:2rem; height:400px; border:1px solid var(--card-border); }
        .perf-table { width:100%; border-collapse:collapse; }
        .perf-table th { font-family:'Cinzel', serif; color:var(--sea-green); padding:0.8rem 0.6rem; border-bottom:2px solid var(--sea-green); cursor:pointer; text-align:left; white-space:nowrap; user-select:none; }
        .perf-table th:hover { background:rgba(46,139,87,0.08); }
        .perf-table td { padding:0.8rem 0.6rem; border-bottom:1px solid rgba(46,139,87,0.15); }
        .perf-table tr:hover td { background:rgba(46,139,87,0.06); }
        .rank-badge { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:var(--sea-green); color:var(--on-accent); font-weight:bold; font-family:'Cinzel', serif; font-size:0.9rem; }
        .perf-card-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:1.5rem; }
        .perf-card { background:var(--card-bg); border-radius:15px; padding:1.5rem; border:1px solid var(--card-border); transition:all 0.3s ease; }
        .perf-card:hover { transform:translateY(-5px); border-color:var(--sea-green); }
        .perf-card-name { font-family:'Cinzel', serif; color:var(--sea-green); font-size:1.2rem; margin-bottom:0.3rem; }
        .perf-card-college { font-size:0.9rem; opacity:0.7; margin-bottom:1rem; }
        .perf-stat-row { display:flex; justify-content:space-between; padding:0.4rem 0; border-bottom:1px solid rgba(46,139,87,0.1); }
        .perf-stat-label { font-family:'Cinzel', serif; font-size:0.85rem; color:var(--sea-green); }
        .perf-stat-value { font-weight:bold; }
        .college-table { width:100%; border-collapse:collapse; }
        .college-table th { padding:0.8rem; text-align:left; font-family:'Cinzel', serif; color:var(--sea-green); border-bottom:1px solid var(--card-border); }
        .college-table td { padding:0.8rem; border-bottom:1px solid rgba(46,139,87,0.15); }
        .back-link { display:inline-flex; align-items:center; gap:0.5rem; background:var(--sea-green); color:var(--on-accent); text-decoration:none; padding:0.8rem 1.5rem; border-radius:8px; font-family:'Cinzel', serif; font-weight:bold; transition:all 0.3s ease; }
        .back-link:hover { transform:translateY(-2px); }
        @media (max-width: 768px) {
          .perf-table-wrapper { overflow-x:auto; }
          .perf-card-grid { grid-template-columns:1fr; }
        }
      `}</style>

      <div className="page player-neo">
        <motion.div
          className="chess-knight-float"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 0.14, scale: 1 }}
          transition={{ delay: 0.9, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 0, fontSize: '2.5rem', color: 'var(--sea-green)' }}
          aria-hidden="true"
        >
          <i className="fas fa-chart-line" />
        </motion.div>

        <AnimatedSidebar links={organizerLinks} logo={<i className="fas fa-chess" />} title={`ChessHive`} />

        <div className="organizer-dash-header" style={{ position: 'fixed', top: 18, right: 18, zIndex: 1001, display: 'flex', gap: '12px', alignItems: 'center' }}>
          <motion.button
            type="button"
            onClick={toggleTheme}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              color: 'var(--text-color)',
              width: 40,
              height: 40,
              borderRadius: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '1.1rem'
            }}
          >
            <i className={isDark ? 'fas fa-sun' : 'fas fa-moon'} />
          </motion.button>
        </div>

        <div className="content">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            <i className="fas fa-chart-line" /> Coordinator Performance
          </motion.h1>

          {error && (
            <div style={{ background: '#ffdddd', color: '#cc0000', padding: '1rem', borderRadius: 8, marginBottom: '1rem' }}>
              <strong>Error:</strong> <span>{error}</span>
            </div>
          )}

          {/* Bar Chart */}
          {!loading && coordinators.length > 0 && (
            <motion.div
              className="chart-wrapper"
              custom={0}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
            >
              <Bar data={chartData} options={chartOptions} />
            </motion.div>
          )}

          {!loading && coordinators.length > 0 && (
            <motion.div
              className="chart-wrapper"
              custom={1}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
            >
              <Line data={growthChartData} options={growthChartOptions} />
            </motion.div>
          )}

          {/* Table View */}
          <motion.div
            className="updates-section"
            custom={2}
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
          >
            <h3><i className="fas fa-table" /> Performance Table</h3>

            {loading ? (
              <p style={{ textAlign: 'center', padding: '2rem' }}><i className="fas fa-spinner fa-spin" /> Loading performance data...</p>
            ) : coordinators.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '2rem', opacity: 0.6 }}><i className="fas fa-info-circle" /> No coordinator performance data available.</p>
            ) : (
              <div className="perf-table-wrapper">
                <table className="perf-table">
                  <thead>
                    <tr>
                      <th onClick={() => handleSort('rank')}>Rank {sortIcon('rank')}</th>
                      <th onClick={() => handleSort('name')}>Name {sortIcon('name')}</th>
                      <th onClick={() => handleSort('college')}>College {sortIcon('college')}</th>
                      <th onClick={() => handleSort('totalTournaments')}>Tournaments {sortIcon('totalTournaments')}</th>
                      <th onClick={() => handleSort('totalProductsSold')}>Products Sold {sortIcon('totalProductsSold')}</th>
                      <th onClick={() => handleSort('storeRevenue')}>Store Revenue {sortIcon('storeRevenue')}</th>
                      <th onClick={() => handleSort('tournamentRevenue')}>Tournament Revenue {sortIcon('tournamentRevenue')}</th>
                      <th onClick={() => handleSort('growthPercentage')}>Growth Trend {sortIcon('growthPercentage')}</th>
                      <th onClick={() => handleSort('totalRevenue')}>Total Revenue {sortIcon('totalRevenue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCoordinators.map((c, idx) => (
                      <motion.tr key={c._id || c.id || idx} variants={itemVariants}>
                        <td><span className="rank-badge">{c.rank ?? idx + 1}</span></td>
                        <td style={{ fontWeight: 600 }}>{c.name || 'Unknown'}</td>
                        <td>{c.college || 'N/A'}</td>
                        <td>{c.totalTournaments ?? 0}</td>
                        <td>{c.totalProductsSold ?? 0}</td>
                        <td>{formatCurrency(c.storeRevenue)}</td>
                        <td>{formatCurrency(c.tournamentRevenue)}</td>
                        <td style={{ color: (c.growthPercentage ?? 0) < 0 ? '#ff6b6b' : 'var(--sea-green)', fontWeight: 600 }}>
                          {`${c.growthPercentage ?? 0}%`}
                        </td>
                        <td style={{ fontWeight: 700, color: 'var(--sea-green)' }}>{formatCurrency(c.totalRevenue)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* Card View (responsive) */}
          {!loading && coordinators.length > 0 && (
            <motion.div
              className="updates-section perf-mobile-cards"
              custom={3}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
            >
              <h3><i className="fas fa-th-large" /> Card View</h3>
              <motion.div className="perf-card-grid" variants={listVariants} initial="hidden" animate="visible">
                {sortedCoordinators.map((c, idx) => (
                  <motion.div key={c._id || c.id || idx} className="perf-card" variants={itemVariants}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.8rem' }}>
                      <span className="rank-badge">{c.rank ?? idx + 1}</span>
                      <div>
                        <div className="perf-card-name">{c.name || 'Unknown'}</div>
                        <div className="perf-card-college"><i className="fas fa-university" /> {c.college || 'N/A'}</div>
                      </div>
                    </div>
                    <div className="perf-stat-row">
                      <span className="perf-stat-label">Tournaments</span>
                      <span className="perf-stat-value">{c.totalTournaments ?? 0}</span>
                    </div>
                    <div className="perf-stat-row">
                      <span className="perf-stat-label">Products Sold</span>
                      <span className="perf-stat-value">{c.totalProductsSold ?? 0}</span>
                    </div>
                    <div className="perf-stat-row">
                      <span className="perf-stat-label">Store Revenue</span>
                      <span className="perf-stat-value">{formatCurrency(c.storeRevenue)}</span>
                    </div>
                    <div className="perf-stat-row">
                      <span className="perf-stat-label">Tournament Revenue</span>
                      <span className="perf-stat-value">{formatCurrency(c.tournamentRevenue)}</span>
                    </div>
                    <div className="perf-stat-row" style={{ borderBottom: 'none' }}>
                      <span className="perf-stat-label">Total Revenue</span>
                      <span className="perf-stat-value" style={{ color: 'var(--sea-green)', fontSize: '1.1rem' }}>{formatCurrency(c.totalRevenue)}</span>
                    </div>
                    <div className="perf-stat-row" style={{ borderBottom: 'none' }}>
                      <span className="perf-stat-label">Growth Trend</span>
                      <span className="perf-stat-value" style={{ color: (c.growthPercentage ?? 0) < 0 ? '#ff6b6b' : 'var(--sea-green)' }}>
                        {`${c.growthPercentage ?? 0}%`}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>
          )}

          {!loading && (
            <motion.div
              className="updates-section"
              custom={4}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
            >
              <h3><i className="fas fa-university" /> College Statistics</h3>
              {collegeStats.length === 0 ? (
                <p style={{ opacity: 0.7 }}>No college statistics available.</p>
              ) : (
                <div className="perf-table-wrapper">
                  <table className="college-table">
                    <thead>
                      <tr>
                        <th>College</th>
                        <th>Coordinators</th>
                        <th>Tournaments</th>
                        <th>Products Sold</th>
                        <th>Total Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collegeStats.map((row) => (
                        <tr key={row.college}>
                          <td>{row.college}</td>
                          <td>{row.coordinators}</td>
                          <td>{row.tournaments}</td>
                          <td>{row.productsSold}</td>
                          <td style={{ color: 'var(--sea-green)', fontWeight: 700 }}>{formatCurrency(row.totalRevenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          <div style={{ textAlign: 'right', marginTop: '1rem' }}>
            <Link to="/organizer/organizer_profile" className="back-link">
              <i className="fas fa-arrow-left" /> Back to Profile
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CoordinatorPerformance;
