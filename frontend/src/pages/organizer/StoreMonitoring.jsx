import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAsOrganizer } from '../../utils/fetchWithRole';
import '../../styles/playerNeoNoir.css';
import { motion } from 'framer-motion';
import usePlayerTheme from '../../hooks/usePlayerTheme';
import AnimatedSidebar from '../../components/AnimatedSidebar';
import { organizerLinks } from '../../constants/organizerLinks';

const PER_PAGE = 10;

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

const StoreMonitoring = () => {
  const [isDark, toggleTheme] = usePlayerTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);

  // Products pagination & search
  const [pPage, setPPage] = useState(0);
  const [pAttr, setPAttr] = useState('name');
  const [pQuery, setPQuery] = useState('');

  // Sales pagination & search
  const [sPage, setSPage] = useState(0);
  const [sAttr, setSAttr] = useState('product');
  const [sQuery, setSQuery] = useState('');

  const loadStoreData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAsOrganizer('/organizer/api/store');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProducts(Array.isArray(data?.products) ? data.products : []);
      setSales(Array.isArray(data?.sales) ? data.sales : []);
      setPPage(0);
      setSPage(0);
    } catch (e) {
      setError('Error loading store data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStoreData(); }, [loadStoreData]);

  const formatCurrency = (n) => `₹${Number(n || 0).toFixed(2)}`;

  // Derived stats
  const totalProducts = products.length;
  const totalInventoryValue = useMemo(
    () => products.reduce((sum, p) => sum + parseFloat(p.price || 0), 0),
    [products]
  );
  const totalSalesCount = sales.length;
  const totalRevenue = useMemo(
    () => sales.reduce((sum, s) => sum + parseFloat(s.price || 0), 0),
    [sales]
  );

  const filteredProducts = useMemo(() => {
    if (!pQuery.trim()) return products;
    const q = pQuery.toLowerCase();
    const getVal = (p) => {
      switch (pAttr) {
        case 'name': return p.name;
        case 'price': return `${p.price}`;
        case 'coordinator': return p.coordinator;
        case 'college': return p.college;
        default: return '';
      }
    };
    return products.filter((p) => (getVal(p) || '').toString().toLowerCase().includes(q));
  }, [products, pQuery, pAttr]);

  const filteredSales = useMemo(() => {
    if (!sQuery.trim()) return sales;
    const q = sQuery.toLowerCase();
    const getVal = (s) => {
      switch (sAttr) {
        case 'product': return s.product;
        case 'price': return `${s.price}`;
        case 'coordinator': return s.coordinator;
        case 'buyer': return s.buyer;
        case 'college': return s.college;
        case 'date': return s.purchase_date ? new Date(s.purchase_date).toLocaleDateString() : '';
        default: return '';
      }
    };
    return sales.filter((s) => (getVal(s) || '').toString().toLowerCase().includes(q));
  }, [sales, sQuery, sAttr]);

  const pStart = pPage * PER_PAGE;
  const pSlice = filteredProducts.slice(pStart, pStart + PER_PAGE);
  const pHasPrev = pPage > 0;
  const pHasNext = pStart + PER_PAGE < filteredProducts.length;

  const sStart = sPage * PER_PAGE;
  const sSlice = filteredSales.slice(sStart, sStart + PER_PAGE);
  const sHasPrev = sPage > 0;
  const sHasNext = sStart + PER_PAGE < filteredSales.length;

  const theme = {
    page: { fontFamily: 'Playfair Display, serif', backgroundColor: '#FFFDD0', minHeight: '100vh', padding: '2rem' },
    container: { maxWidth: 1200, margin: '0 auto 2rem auto' },
    h2: { fontFamily: 'Cinzel, serif', fontSize: '2.5rem', color: '#2E8B57', marginBottom: '2rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' },
    tableDiv: { background: 'var(--card-bg)', borderRadius: 15, padding: '2rem', boxShadow: 'none', border: '1px solid var(--card-border)', overflowX: 'auto' },
    th: { backgroundColor: '#2E8B57', color: '#FFFDD0', padding: '1.2rem', textAlign: 'left', fontFamily: 'Cinzel, serif' },
    td: { padding: '1rem', borderBottom: '1px solid rgba(46,139,87,0.2)', verticalAlign: 'middle' },
    price: { fontWeight: 'bold', color: '#2E8B57' },
    empty: { textAlign: 'center', padding: '2rem', color: '#2E8B57', fontStyle: 'italic' },
    statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' },
    statCard: { background: 'var(--card-bg)', padding: '1.5rem', borderRadius: 10, textAlign: 'center', boxShadow: 'none', border: '1px solid var(--card-border)' },
    statValue: { fontSize: '1.8rem', fontWeight: 'bold', color: '#2E8B57', marginBottom: '.5rem' },
    statLabel: { color: '#666', fontSize: '.9rem' },
    backRight: { textAlign: 'right', marginTop: '2rem' },
    backLink: { display: 'inline-flex', alignItems: 'center', gap: '.5rem', backgroundColor: '#2E8B57', color: '#FFFDD0', textDecoration: 'none', padding: '.8rem 1.5rem', borderRadius: 8, transition: 'all .3s ease', fontFamily: 'Cinzel, serif', fontWeight: 'bold' },
    pager: { textAlign: 'center', margin: '1rem 0', display: 'flex', justifyContent: 'center', gap: '1rem' },
    pageBtn: { display: 'inline-flex', alignItems: 'center', gap: '.5rem', backgroundColor: '#87CEEB', color: '#2E8B57', textDecoration: 'none', padding: '.8rem 1.5rem', borderRadius: 8, transition: 'all .3s ease', fontFamily: 'Cinzel, serif', fontWeight: 'bold', cursor: 'pointer' },
    searchBar: { display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: '#f5f5f5', borderRadius: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.1)', maxWidth: 500, margin: '20px auto' },
    select: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--card-border)', backgroundColor: 'var(--card-bg)', fontSize: 14 },
    input: { flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14 },
    rowCounter: { textAlign: 'center', marginBottom: '1rem', fontFamily: 'Cinzel, serif', fontSize: '1.2rem', color: '#2E8B57', backgroundColor: 'rgba(46,139,87,0.1)', padding: '.5rem 1rem', borderRadius: 8, display: 'inline-block' },
    error: { color: '#c62828', textAlign: 'center', marginBottom: '1rem' },
  };

  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{`
        * { margin:0; padding:0; box-sizing:border-box; }
        body, #root { min-height: 100vh; }
        .page { font-family: 'Playfair Display', serif; background-color: var(--page-bg); min-height: 100vh; display:flex; color: var(--text-color); }
        .content { flex-grow:1; margin-left:0; padding:2rem; }
        h1 { font-family:'Cinzel', serif; color:var(--sea-green); margin-bottom:2rem; font-size:2.5rem; display:flex; align-items:center; gap:1rem; }
        .updates-section { background:var(--card-bg); border-radius:15px; padding:2rem; margin-bottom:2rem; box-shadow:none; border:1px solid var(--card-border); transition: transform 0.3s ease; overflow-x:auto; }
        .updates-section:hover { transform: translateY(-5px); }
        .table { width:100%; border-collapse:collapse; margin-bottom:1rem; }
        .th { background:var(--sea-green); color:var(--on-accent); padding:1.2rem; text-align:left; font-family:'Cinzel', serif; }
        .td { padding:1rem; border-bottom:1px solid rgba(var(--sea-green-rgb, 27, 94, 63), 0.2); vertical-align:middle; }
        .price { font-weight:bold; color:var(--sea-green); }
        .empty { text-align:center; padding:2rem; color:var(--sea-green); font-style:italic; }
        .stats-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:1.5rem; margin-bottom:2rem; }
        .stat-card { background:var(--card-bg); padding:1.5rem; border-radius:10px; text-align:center; box-shadow:none; border:1px solid var(--card-border); }
        .stat-value { font-size:1.8rem; font-weight:bold; color:var(--sea-green); margin-bottom:0.5rem; }
        .stat-label { color:var(--text-color); font-size:0.9rem; opacity:0.8; }
        .back-link { display:inline-flex; align-items:center; gap:0.5rem; background-color:var(--sea-green); color:var(--on-accent); text-decoration:none; padding:0.8rem 1.5rem; border-radius:8px; transition:all 0.3s ease; font-family:'Cinzel', serif; font-weight:bold; }
        .pager { text-align:center; margin:1rem 0; display:flex; justify-content:center; gap:1rem; }
        .page-btn { display:inline-flex; align-items:center; gap:0.5rem; background-color:var(--sea-green); color:var(--on-accent); text-decoration:none; padding:0.8rem 1.5rem; border-radius:8px; transition:all 0.3s ease; font-family:'Cinzel', serif; font-weight:bold; cursor:pointer; border:none; }
        .search-bar { display:flex; align-items:center; gap:10px; padding:10px; background:var(--card-bg); border-radius:10px; box-shadow:0 2px 6px rgba(0,0,0,0.1); max-width:500px; margin:20px auto; border:1px solid var(--card-border); }
        .select { padding:10px 14px; border-radius:8px; border:1px solid var(--card-border); background:var(--page-bg); color:var(--text-color); font-size:16px; }
        .input { flex:1; padding:10px 14px; border-radius:8px; border:1px solid var(--card-border); background:var(--page-bg); color:var(--text-color); font-size:16px; min-width:300px; }
        .row-counter { text-align:center; margin-bottom:1rem; font-family:'Cinzel', serif; font-size:1.2rem; color:var(--sea-green); background-color:rgba(var(--sea-green-rgb, 27, 94, 63), 0.1); padding:0.5rem 1rem; border-radius:8px; display:inline-block; }
        .error { color:#c62828; text-align:center; margin-bottom:1rem; }
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
          <i className="fas fa-store" />
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
          {/* Products Overview */}
          <div className="products">
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <i className="fas fa-box" /> Products Overview
            </motion.h1>

            {error && <div className="error">{error}</div>}

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value"><i className="fas fa-box" /> <span>{totalProducts}</span></div>
                <div className="stat-label">Total Products</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(totalInventoryValue)}</div>
                <div className="stat-label">Total Inventory Value</div>
              </div>
              <div style={{ textAlign: 'right', marginBottom: '1rem' }}>
                <Link to="/organizer/sales_analysis" className="back-link"><i className="fas fa-chart-line" /> View Sales Analysis</Link>
              </div>
            </div>

            <motion.div
              className="updates-section"
              custom={0}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
            >
              <div className="search-bar">
                <select aria-label="Product attribute" value={pAttr} onChange={(e) => { setPAttr(e.target.value); setPPage(0); }} className="select">
                  <option value="name">Product</option>
                  <option value="price">Price</option>
                  <option value="coordinator">Coordinator</option>
                  <option value="college">College</option>
                </select>
                <input aria-label="Product search" value={pQuery} onChange={(e) => { setPQuery(e.target.value); setPPage(0); }} placeholder="Search products…" className="input" />
              </div>

              {loading ? (
                <p>Loading…</p>
              ) : (
                <>
                  <div style={{ textAlign: 'center' }}>
                    <span className="row-counter">{filteredProducts.length} item(s)</span>
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="th"><i className="fas fa-tag" /> Product</th>
                        <th className="th"><i className="fas fa-rupee-sign" /> Price</th>
                        <th className="th"><i className="fas fa-user" /> Coordinator</th>
                        <th className="th"><i className="fas fa-university" /> College</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.length === 0 ? (
                        <tr><td className="td empty" colSpan={4}><i className="fas fa-box-open" /> No products available.</td></tr>
                      ) : (
                        pSlice.map((p, idx) => (
                          <tr key={`${p.name}-${idx}`}>
                            <td className="td">{p.name}</td>
                            <td className="td price">{formatCurrency(p.price)}</td>
                            <td className="td">{p.coordinator || 'N/A'}</td>
                            <td className="td">{p.college || 'N/A'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>

                  <div className="pager">
                    {pHasPrev && (
                      <button type="button" className="page-btn" onClick={() => setPPage((v) => Math.max(0, v - 1))}>
                        <i className="fas fa-chevron-left" /> Previous
                      </button>
                    )}
                    {pHasNext && (
                      <button type="button" className="page-btn" onClick={() => setPPage((v) => v + 1)}>
                        <i className="fas fa-chevron-right" /> Next
                      </button>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </div>

          {/* Sales Report */}
          <div className="sales">
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            >
              <i className="fas fa-chart-bar" /> Sales Report
            </motion.h1>

            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value"><i className="fas fa-shopping-cart" /> <span>{totalSalesCount}</span></div>
                <div className="stat-label">Total Sales</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{formatCurrency(totalRevenue)}</div>
                <div className="stat-label">Total Revenue</div>
              </div>
            </div>

            <motion.div
              className="updates-section"
              custom={1}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
            >
              <div className="search-bar">
                <select aria-label="Sales attribute" value={sAttr} onChange={(e) => { setSAttr(e.target.value); setSPage(0); }} className="select">
                  <option value="product">Product</option>
                  <option value="price">Price</option>
                  <option value="coordinator">Coordinator</option>
                  <option value="buyer">Buyer</option>
                  <option value="college">College</option>
                  <option value="date">Date</option>
                </select>
                <input aria-label="Sales search" value={sQuery} onChange={(e) => { setSQuery(e.target.value); setSPage(0); }} placeholder="Search sales…" className="input" />
              </div>

              {loading ? (
                <p>Loading…</p>
              ) : (
                <>
                  <div style={{ textAlign: 'center' }}>
                    <span className="row-counter">{filteredSales.length} record(s)</span>
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="th"><i className="fas fa-tag" /> Product</th>
                        <th className="th"><i className="fas fa-rupee-sign" /> Price</th>
                        <th className="th"><i className="fas fa-user" /> Coordinator</th>
                        <th className="th"><i className="fas fa-user-check" /> Buyer</th>
                        <th className="th"><i className="fas fa-university" /> College</th>
                        <th className="th"><i className="fas fa-calendar" /> Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSales.length === 0 ? (
                        <tr><td className="td empty" colSpan={6}><i className="fas fa-shopping-cart" /> No sales recorded.</td></tr>
                      ) : (
                        sSlice.map((s, idx) => (
                          <tr key={`${s.product}-${s.buyer}-${idx}`}>
                            <td className="td">{s.product}</td>
                            <td className="td price">{formatCurrency(s.price)}</td>
                            <td className="td">{s.coordinator || 'N/A'}</td>
                            <td className="td">{s.buyer || 'N/A'}</td>
                            <td className="td">{s.college || 'N/A'}</td>
                            <td className="td">{s.purchase_date ? new Date(s.purchase_date).toLocaleDateString() : ''}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>

                  <div className="pager">
                    {sHasPrev && (
                      <button type="button" className="page-btn" onClick={() => setSPage((v) => Math.max(0, v - 1))}>
                        <i className="fas fa-chevron-left" /> Previous
                      </button>
                    )}
                    {sHasNext && (
                      <button type="button" className="page-btn" onClick={() => setSPage((v) => v + 1)}>
                        <i className="fas fa-chevron-right" /> Next
                      </button>
                    )}
                  </div>
                </>
              )}

              <div style={{ textAlign: 'right', marginTop: '2rem' }}>
                <Link to="/organizer/organizer_dashboard" className="back-to-dashboard">
                  <i className="fas fa-arrow-left" /> Back to Dashboard
                </Link>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoreMonitoring;
