import { useState, useMemo } from 'react';

const COUNTRY_FLAGS = {
  CHILE: '🇨🇱',
  COLOMBIA: '🇨🇴',
  'COSTA RICA': '🇨🇷',
  ECUADOR: '🇪🇨',
  MEXICO: '🇲🇽',
  PSMEXICO: '🇲🇽',
  PARAGUAY: '🇵🇾',
  PERU: '🇵🇪',
  URUGUAY: '🇺🇾',
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function getFlag(countryName) {
  const clean = String(countryName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  return COUNTRY_FLAGS[clean] || '🌎';
}

export default function Operators({
  enrichedRecords,
  selectedOperatorCode,
  setSelectedOperatorCode,
}) {
  // Estados de filtros y ordenamiento de la vista general de Operadores
  const [selectedCountry, setSelectedCountry] = useState('Todos los países');
  const [selectedTLFilter, setSelectedTLFilter] = useState('Todos los Team Leaders');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('ventas');
  const [sortOrder, setSortOrder] = useState('desc');

  // Estados para la tabla de órdenes dentro del detalle (Drill-down) del operador
  const [opOrderSearch, setOpOrderSearch] = useState('');
  const [opOrderCategory, setOpOrderCategory] = useState('all'); // 'all' | 'approve' | 'reject' | 'trash'
  const [opOrderSortField, setOpOrderSortField] = useState('orderNumber');
  const [opOrderSortDir, setOpOrderSortDir] = useState('desc');
  const [defaultOrderAction, setDefaultOrderAction] = useState('llenado'); // 'llenado' | 'escuchar'
  const [rowOrderActions, setRowOrderActions] = useState({});

  const handleSortClick = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'operador' || field === 'teamLeader' ? 'asc' : 'desc');
    }
  };

  const handleOpOrderSort = (field) => {
    if (opOrderSortField === field) {
      setOpOrderSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setOpOrderSortField(field);
      setOpOrderSortDir(field === 'country' ? 'asc' : 'desc');
    }
  };

  const open2wCallOrder = (rawOrderNum, actionMode) => {
    const cleanId = String(rawOrderNum || '').replace(/[^\d]/g, '').trim();
    if (!cleanId) return;
    const targetUrl =
      actionMode === 'escuchar'
        ? `https://panel.2wcall.com/order/index/view/${cleanId}#call_records`
        : `https://panel.2wcall.com/order/change/${cleanId}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  // Listas desplegables
  const countriesList = useMemo(() => {
    const unique = new Set(enrichedRecords.map((r) => r.country).filter(Boolean));
    return ['Todos los países', ...Array.from(unique)];
  }, [enrichedRecords]);

  const teamLeadersList = useMemo(() => {
    const unique = new Set(enrichedRecords.map((r) => r.teamLeader).filter(Boolean));
    return ['Todos los Team Leaders', ...Array.from(unique)];
  }, [enrichedRecords]);

  // Filtrar registros según selectores y búsqueda
  const filteredRecords = useMemo(() => {
    const q = normalizeText(searchQuery);
    return enrichedRecords.filter((rec) => {
      if (selectedCountry !== 'Todos los países' && rec.country !== selectedCountry) {
        return false;
      }
      if (
        selectedTLFilter !== 'Todos los Team Leaders' &&
        rec.teamLeader !== selectedTLFilter
      ) {
        return false;
      }
      if (q) {
        const matchUser = normalizeText(rec.usuario).includes(q);
        const matchOp = normalizeText(rec.operador).includes(q);
        const matchTL = normalizeText(rec.teamLeader).includes(q);
        const matchCountry = normalizeText(rec.country).includes(q);
        return matchUser || matchOp || matchTL || matchCountry;
      }
      return true;
    });
  }, [enrichedRecords, selectedCountry, selectedTLFilter, searchQuery]);

  // Agrupación por Operador (con Check = 0 si ventas === 0)
  // Agrupación por Operador (con Check = 0 si ventas === 0 y lista de TODOS los países que toca)
  const operatorStats = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((rec) => {
      if (!map.has(rec.usuario)) {
        map.set(rec.usuario, {
          teamLeader: rec.teamLeader,
          operador: rec.operador,
          usuario: rec.usuario,
          country: rec.country,
          countriesSet: new Set(),
          leads: 0,
          ventas: 0,
          rechazos: 0,
          trash: 0,
          pending: 0,
          sumApprovedUsd: 0,
        });
      }
      const item = map.get(rec.usuario);
      if (rec.country) {
        item.countriesSet.add(rec.country);
      }
      item.leads += 1;

      if (rec.category === 'approve') {
        item.ventas += 1;
        item.sumApprovedUsd += rec.priceUsd;
      } else if (rec.category === 'reject') {
        item.rechazos += 1;
      } else if (rec.category === 'trash') {
        item.trash += 1;
      } else {
        item.pending += 1;
      }
    });

    const list = Array.from(map.values()).map((item) => {
      const checkUsd = item.ventas > 0 ? item.sumApprovedUsd / item.ventas : 0;
      const approvalPct = item.leads > 0 ? (item.ventas / item.leads) * 100 : 0;
      const rejectPct = item.leads > 0 ? (item.rechazos / item.leads) * 100 : 0;
      const trashPct = item.leads > 0 ? (item.trash / item.leads) * 100 : 0;
      const countries = Array.from(item.countriesSet);

      return {
        ...item,
        countries,
        countriesDisplay: countries.join(', '),
        checkUsd,
        approvalPct,
        rejectPct,
        trashPct,
      };
    });

    return [...list].sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (typeof valA === 'string' || typeof valB === 'string') {
        const cmp = String(valA || '').localeCompare(String(valB || ''), 'es', {
          sensitivity: 'base',
        });
        return sortOrder === 'asc' ? cmp : -cmp;
      }
      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      if (numA === numB) return (b.ventas || 0) - (a.ventas || 0);
      return sortOrder === 'asc' ? numA - numB : numB - numA;
    });
  }, [filteredRecords, sortField, sortOrder]);

  // Totales de las tarjetas superiores de esta vista
  const viewTotals = useMemo(() => {
    let leads = 0;
    let ventas = 0;
    let rechazos = 0;
    let trash = 0;
    let pending = 0;
    let sumApprovedUsd = 0;
    const opsSet = new Set();
    const tlSet = new Set();

    filteredRecords.forEach((r) => {
      leads += 1;
      opsSet.add(r.usuario);
      if (r.teamLeader !== 'Sin asignar') tlSet.add(r.teamLeader);

      if (r.category === 'approve') {
        ventas += 1;
        sumApprovedUsd += r.priceUsd;
      } else if (r.category === 'reject') {
        rechazos += 1;
      } else if (r.category === 'trash') {
        trash += 1;
      } else {
        pending += 1;
      }
    });

    const checkUsd = ventas > 0 ? sumApprovedUsd / ventas : 0;
    const approvalPct = leads > 0 ? (ventas / leads) * 100 : 0;
    const rejectPct = leads > 0 ? (rechazos / leads) * 100 : 0;
    const trashPct = leads > 0 ? (trash / leads) * 100 : 0;

    return {
      leads,
      ventas,
      rechazos,
      trash,
      pending,
      checkUsd,
      approvalPct,
      rejectPct,
      trashPct,
      operadores: opsSet.size,
      teamLeaders: tlSet.size,
    };
  }, [filteredRecords]);

  // Datos para los gráficos inferiores
  const chartItems = useMemo(() => operatorStats.slice(0, 20), [operatorStats]);
  const maxLeadsInChart = useMemo(
    () => Math.max(...chartItems.map((i) => i.leads || 1), 1),
    [chartItems]
  );
  const maxCheckInChart = useMemo(
    () => Math.max(...chartItems.map((i) => i.checkUsd || 1), 100),
    [chartItems]
  );

  // Detalle cuando se selecciona un operador (Drill-down)
  const activeOperatorDetail = useMemo(() => {
    if (!selectedOperatorCode) return null;
    const stats = operatorStats.find((o) => o.usuario === selectedOperatorCode);
    const records = enrichedRecords.filter((r) => r.usuario === selectedOperatorCode);
    return { stats, records };
  }, [selectedOperatorCode, operatorStats, enrichedRecords]);

  // ====================================================================
  // RENDERIZADO 1: VISTA DRILL-DOWN DE UN OPERADOR ESPECÍFICO
  // ====================================================================
  if (selectedOperatorCode && activeOperatorDetail?.stats) {
    const allOpRecords = activeOperatorDetail.records || [];
    const q = normalizeText(opOrderSearch);

    const filteredOpOrders = allOpRecords.filter((rec) => {
      if (opOrderCategory !== 'all' && rec.category !== opOrderCategory) {
        return false;
      }
      if (q) {
        const matchId = normalizeText(rec.orderNumber).includes(q);
        const matchCountry = normalizeText(rec.country).includes(q);
        const matchProd = normalizeText(rec.products).includes(q);
        const matchStatus = normalizeText(rec.rawStatus).includes(q);
        return matchId || matchCountry || matchProd || matchStatus;
      }
      return true;
    });

    const sortedOpOrders = [...filteredOpOrders].sort((a, b) => {
      if (opOrderSortField === 'country') {
        const cmp = String(a.country || '').localeCompare(String(b.country || ''), 'es', {
          sensitivity: 'base',
        });
        return opOrderSortDir === 'asc' ? cmp : -cmp;
      }
      if (opOrderSortField === 'orderNumber') {
        const numA = parseInt(String(a.orderNumber || '').replace(/[^\d]/g, ''), 10) || 0;
        const numB = parseInt(String(b.orderNumber || '').replace(/[^\d]/g, ''), 10) || 0;
        return opOrderSortDir === 'asc' ? numA - numB : numB - numA;
      }
      const valA = Number(a[opOrderSortField]) || 0;
      const valB = Number(b[opOrderSortField]) || 0;
      return opOrderSortDir === 'asc' ? valA - valB : valB - valA;
    });

    return (
      <div>
        <button
          className="gtl-btn-secondary"
          style={{ marginBottom: '18px', padding: '10px 16px', fontSize: '13px', fontWeight: 700 }}
          onClick={() => setSelectedOperatorCode(null)}
        >
          ← Volver a la Tabla General de Operadores
        </button>

        {/* Encabezado del Operador */}
        <div
          className="gtl-card"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}
        >
          <div>
            <span className="gtl-pill" style={{ fontSize: '11px', marginBottom: '8px', display: 'inline-block' }}>
              USUARIO: {activeOperatorDetail.stats.usuario}
            </span>
            <h2 style={{ margin: '6px 0 4px', fontSize: '24px', fontWeight: 800 }}>
              {activeOperatorDetail.stats.operador}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
              Team Leader: <strong>{activeOperatorDetail.stats.teamLeader}</strong> | Países tocados:{' '}
              <strong>
                {(activeOperatorDetail.stats.countries || [activeOperatorDetail.stats.country])
                  .map((c) => `${getFlag(c)} ${c}`)
                  .join(' • ')}
              </strong>
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Check Promedio del Operador
            </div>
            <div style={{ fontSize: '30px', fontWeight: 800, color: 'var(--accent-Warm)' }}>
              ${activeOperatorDetail.stats.checkUsd.toFixed(2)} USD
            </div>
          </div>
        </div>

        {/* Tarjetas KPI del Operador */}
        <div className="gtl-kpi-grid">
          <div className="gtl-kpi-card">
            <div className="gtl-kpi-label">Total Leads</div>
            <div className="gtl-kpi-value">{activeOperatorDetail.stats.leads}</div>
            <div className="gtl-kpi-sub">Órdenes asignadas</div>
          </div>
          <div className="gtl-kpi-card">
            <div className="gtl-kpi-label">Ventas (Approve)</div>
            <div className="gtl-kpi-value" style={{ color: 'var(--badge-green-text)' }}>
              {activeOperatorDetail.stats.ventas}
            </div>
            <div className="gtl-kpi-sub">
              {activeOperatorDetail.stats.approvalPct.toFixed(1)}% de conversión
            </div>
          </div>
          <div className="gtl-kpi-card">
            <div className="gtl-kpi-label">Rechazos (Reject)</div>
            <div className="gtl-kpi-value" style={{ color: 'var(--badge-red-text)' }}>
              {activeOperatorDetail.stats.rechazos}
            </div>
            <div className="gtl-kpi-sub">
              {activeOperatorDetail.stats.rejectPct.toFixed(1)}% del total
            </div>
          </div>
          <div className="gtl-kpi-card">
            <div className="gtl-kpi-label">Trash / Basura</div>
            <div className="gtl-kpi-value" style={{ color: 'var(--badge-amber-text)' }}>
              {activeOperatorDetail.stats.trash}
            </div>
            <div className="gtl-kpi-sub">
              {activeOperatorDetail.stats.trashPct.toFixed(1)}% del total
            </div>
          </div>
          <div className="gtl-kpi-card">
            <div className="gtl-kpi-label">Check Promedio (USD)</div>
            <div className="gtl-kpi-value" style={{ color: 'var(--accent-Warm)' }}>
              ${activeOperatorDetail.stats.checkUsd.toFixed(2)}
            </div>
            <div className="gtl-kpi-sub">Ticket promedio en dólares</div>
          </div>
        </div>

        {/* Cuadros Gráficos del Operador */}
        <div className="gtl-charts-grid" style={{ marginTop: 0, marginBottom: '20px' }}>
          <div className="gtl-card" style={{ marginBottom: 0 }}>
            <strong style={{ display: 'block', fontSize: '14px', textTransform: 'uppercase', marginBottom: '14px' }}>
              📊 Proporción de Resultados de {activeOperatorDetail.stats.operador}
            </strong>
            <div className="gtl-bar-track" style={{ height: '24px', marginBottom: '12px' }}>
              <div
                className="gtl-bar-fill-approve"
                style={{ width: `${activeOperatorDetail.stats.approvalPct}%` }}
                title={`Approve: ${activeOperatorDetail.stats.ventas}`}
              />
              <div
                className="gtl-bar-fill-reject"
                style={{ width: `${activeOperatorDetail.stats.rejectPct}%` }}
                title={`Reject: ${activeOperatorDetail.stats.rechazos}`}
              />
              <div
                className="gtl-bar-fill-trash"
                style={{ width: `${activeOperatorDetail.stats.trashPct}%` }}
                title={`Trash: ${activeOperatorDetail.stats.trash}`}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', fontSize: '12px', fontWeight: 700 }}>
              <span style={{ color: 'var(--badge-green-text)' }}>
                🟢 Approve: {activeOperatorDetail.stats.ventas} ({activeOperatorDetail.stats.approvalPct.toFixed(1)}%)
              </span>
              <span style={{ color: 'var(--badge-red-text)' }}>
                🔴 Reject: {activeOperatorDetail.stats.rechazos} ({activeOperatorDetail.stats.rejectPct.toFixed(1)}%)
              </span>
              <span style={{ color: 'var(--badge-amber-text)' }}>
                🟤 Trash: {activeOperatorDetail.stats.trash} ({activeOperatorDetail.stats.trashPct.toFixed(1)}%)
              </span>
            </div>
          </div>

          <div className="gtl-card" style={{ marginBottom: 0 }}>
            <strong style={{ display: 'block', fontSize: '14px', textTransform: 'uppercase', marginBottom: '14px' }}>
              📈 Desglose por Categoría
            </strong>
            <div className="gtl-bar-row">
              <div className="gtl-bar-label">🟢 Ventas (Approve)</div>
              <div className="gtl-bar-track">
                <div className="gtl-bar-fill-approve" style={{ width: `${activeOperatorDetail.stats.approvalPct}%` }} />
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>{activeOperatorDetail.stats.ventas}</div>
            </div>
            <div className="gtl-bar-row">
              <div className="gtl-bar-label">🔴 Rechazos (Reject)</div>
              <div className="gtl-bar-track">
                <div className="gtl-bar-fill-reject" style={{ width: `${activeOperatorDetail.stats.rejectPct}%` }} />
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>{activeOperatorDetail.stats.rechazos}</div>
            </div>
            <div className="gtl-bar-row">
              <div className="gtl-bar-label">🟤 Trash / Basura</div>
              <div className="gtl-bar-track">
                <div className="gtl-bar-fill-trash" style={{ width: `${activeOperatorDetail.stats.trashPct}%` }} />
              </div>
              <div style={{ textAlign: 'right', fontWeight: 700 }}>{activeOperatorDetail.stats.trash}</div>
            </div>
          </div>
        </div>

        {/* Tabla de Órdenes del Operador con Selector 2wcall */}
        <div className="gtl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
            <strong style={{ fontSize: '14px', textTransform: 'uppercase' }}>
              📋 ÓRDENES TOCADAS POR EL OPERADOR {activeOperatorDetail.stats.operador} ({sortedOpOrders.length} DE {allOpRecords.length} ÓRDENES)
            </strong>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
                Acción por defecto al tocar ID:
              </span>
              <select
                className="gtl-select"
                style={{ width: 'auto', padding: '6px 10px', fontWeight: 700 }}
                value={defaultOrderAction}
                onChange={(e) => {
                  setDefaultOrderAction(e.target.value);
                  setRowOrderActions({});
                }}
              >
                <option value="llenado">📝 Ver llenado (Default)</option>
                <option value="escuchar">🎧 Escuchar llamada</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', marginBottom: '12px' }}>
            <button
              className={`gtl-btn-secondary ${opOrderCategory === 'all' ? 'active' : ''}`}
              onClick={() => setOpOrderCategory('all')}
            >
              Todas ({allOpRecords.length})
            </button>
            <button
              className={`gtl-btn-secondary ${opOrderCategory === 'approve' ? 'active' : ''}`}
              onClick={() => setOpOrderCategory('approve')}
            >
              🟢 Solo Ventas / Approve ({activeOperatorDetail.stats.ventas})
            </button>
            <button
              className={`gtl-btn-secondary ${opOrderCategory === 'reject' ? 'active' : ''}`}
              onClick={() => setOpOrderCategory('reject')}
            >
              🔴 Solo Rechazos / Reject ({activeOperatorDetail.stats.rechazos})
            </button>
            <button
              className={`gtl-btn-secondary ${opOrderCategory === 'trash' ? 'active' : ''}`}
              onClick={() => setOpOrderCategory('trash')}
            >
              🟤 Solo Trash ({activeOperatorDetail.stats.trash})
            </button>

            <div style={{ flex: 1, minWidth: '220px' }}>
              <input
                type="text"
                className="gtl-input"
                placeholder="🔍 Buscar por N° de orden, producto o país..."
                value={opOrderSearch}
                onChange={(e) => setOpOrderSearch(e.target.value)}
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              padding: '10px 12px',
              background: 'var(--bg-elevated)',
              borderRadius: '8px',
              marginBottom: '14px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
              Ordenar órdenes por:
            </span>

            <button
              className={`gtl-btn-secondary ${opOrderSortField === 'orderNumber' ? 'active' : ''}`}
              onClick={() => handleOpOrderSort('orderNumber')}
            >
              N° Orden {opOrderSortField === 'orderNumber' ? (opOrderSortDir === 'desc' ? '↓ Recientes' : '↑ Antiguas') : ''}
            </button>

            <button
              className={`gtl-btn-secondary ${opOrderSortField === 'priceUsd' ? 'active' : ''}`}
              onClick={() => handleOpOrderSort('priceUsd')}
            >
              Check (USD) {opOrderSortField === 'priceUsd' ? (opOrderSortDir === 'desc' ? '↓ Mayor a menor' : '↑ Menor a mayor') : ''}
            </button>

            <button
              className={`gtl-btn-secondary ${opOrderSortField === 'finalPriceLocal' ? 'active' : ''}`}
              onClick={() => handleOpOrderSort('finalPriceLocal')}
            >
              Precio Local {opOrderSortField === 'finalPriceLocal' ? (opOrderSortDir === 'desc' ? '↓ Mayor a menor' : '↑ Menor a mayor') : ''}
            </button>

            <button
              className={`gtl-btn-secondary ${opOrderSortField === 'country' ? 'active' : ''}`}
              onClick={() => handleOpOrderSort('country')}
            >
              País (A-Z) {opOrderSortField === 'country' ? (opOrderSortDir === 'asc' ? '↑ A-Z' : '↓ Z-A') : ''}
            </button>
          </div>

          <div className="gtl-table-scroll-20">
            <table className="gtl-table">
              <thead>
                <tr>
                  <th style={{ width: '55px', textAlign: 'center' }}>N°</th>
                  <th>ID</th>
                  <th>PAÍS</th>
                  <th>PRODUCTO</th>
                  <th>ESTATUS</th>
                  <th>CHECK (USD)</th>
                </tr>
              </thead>
              <tbody>
                {sortedOpOrders.map((rec, idx) => {
                  const orderId = String(rec.orderNumber || '').trim();
                  const rowKey = `${orderId}_${idx}`;
                  const selectedMode = rowOrderActions[rowKey] || defaultOrderAction;

                  return (
                    <tr key={rowKey}>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--text-muted)' }}>
                        {idx + 1}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => open2wCallOrder(orderId, selectedMode)}
                            title={
                              selectedMode === 'escuchar'
                                ? `Ir a Escuchar orden ${orderId}`
                                : `Ir a Ver llenado de orden ${orderId}`
                            }
                            style={{
                              background: 'var(--bg-elevated)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--accent-Warm)',
                              borderRadius: '6px',
                              padding: '5px 10px',
                              fontFamily: 'monospace',
                              fontWeight: 800,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <span>{orderId || `#${idx + 1}`}</span>
                            <span style={{ fontSize: '11px', color: 'var(--accent-Warm)' }}>↗</span>
                          </button>

                          <select
                            value={selectedMode}
                            onChange={(e) => {
                              const newMode = e.target.value;
                              setRowOrderActions((prev) => ({
                                ...prev,
                                [rowKey]: newMode,
                              }));
                            }}
                            style={{
                              background: 'var(--bg-input)',
                              color: 'var(--text-secondary)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              padding: '4px 8px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            <option value="llenado">📝 Ver llenado</option>
                            <option value="escuchar">🎧 Escuchar</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        {getFlag(rec.country)} {rec.country}
                      </td>
                      <td
                        style={{
                          maxWidth: '280px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={rec.products}
                      >
                        {rec.products || '-'}
                      </td>
                      <td>
                        <span
                          className={`gtl-badge ${
                            rec.category === 'approve'
                              ? 'gtl-badge-green'
                              : rec.category === 'reject'
                              ? 'gtl-badge-red'
                              : 'gtl-badge-amber'
                          }`}
                        >
                          {rec.category.toUpperCase()}
                        </span>
                      </td>
                      <td className="gtl-check-cell">
                        ${rec.category === 'approve' ? rec.priceUsd.toFixed(2) : '0.00'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ====================================================================
  // RENDERIZADO 2: VISTA GENERAL DE OPERADORES
  // ====================================================================
  return (
    <>
      {/* 1. TARJETAS DE INDICADORES CLAVE (KPIs) */}
      <div className="gtl-kpi-grid">
        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Total Leads</div>
          <div className="gtl-kpi-value">{viewTotals.leads}</div>
          <div className="gtl-kpi-sub">
            {viewTotals.operadores} operadores | {viewTotals.teamLeaders} TLs
          </div>
        </div>

        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Ventas (Approve)</div>
          <div className="gtl-kpi-value" style={{ color: 'var(--badge-green-text)' }}>
            {viewTotals.ventas}
          </div>
          <div className="gtl-kpi-sub">
            {viewTotals.approvalPct.toFixed(1)}% de conversión
          </div>
        </div>

        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Rechazos (Reject)</div>
          <div className="gtl-kpi-value" style={{ color: 'var(--badge-red-text)' }}>
            {viewTotals.rechazos}
          </div>
          <div className="gtl-kpi-sub">
            {viewTotals.rejectPct.toFixed(1)}% del total
          </div>
        </div>

        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Trash / Basura</div>
          <div className="gtl-kpi-value" style={{ color: 'var(--badge-amber-text)' }}>
            {viewTotals.trash}
          </div>
          <div className="gtl-kpi-sub">
            {viewTotals.trashPct.toFixed(1)}% del total
          </div>
        </div>

        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Check Promedio (USD)</div>
          <div className="gtl-kpi-value" style={{ color: 'var(--accent-Warm)' }}>
            ${viewTotals.checkUsd.toFixed(2)}
          </div>
          <div className="gtl-kpi-sub">Ticket promedio en dólares</div>
        </div>
      </div>

      {/* 2. FILTROS, ORDENAMIENTO Y TABLA DE OPERADORES */}
      <div className="gtl-card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '12px', marginBottom: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
              CAMPAÑA / PAÍS
            </label>
            <select
              className="gtl-select"
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
            >
              {countriesList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
              FILTRAR POR TEAM LEADER
            </label>
            <select
              className="gtl-select"
              value={selectedTLFilter}
              onChange={(e) => setSelectedTLFilter(e.target.value)}
            >
              {teamLeadersList.map((tl) => (
                <option key={tl} value={tl}>
                  {tl}
                </option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
              BUSCAR OPERADOR, USUARIO (PEROP1AM-...) O TEAM LEADER
            </label>
            <input
              type="text"
              className="gtl-input"
              placeholder="Escribe un nombre, código de usuario o Team Leader..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '10px 12px',
            background: 'var(--bg-elevated)',
            borderRadius: '8px',
            marginBottom: '14px',
          }}
        >
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', marginRight: '4px' }}>
            Ordenar por:
          </span>

          <button
            className={`gtl-btn-secondary ${sortField === 'ventas' ? 'active' : ''}`}
            onClick={() => handleSortClick('ventas')}
          >
            Ventas (Approve) {sortField === 'ventas' ? (sortOrder === 'desc' ? '↓ Mayor a menor' : '↑ Menor a mayor') : ''}
          </button>

          <button
            className={`gtl-btn-secondary ${sortField === 'checkUsd' ? 'active' : ''}`}
            onClick={() => handleSortClick('checkUsd')}
          >
            Check (USD) {sortField === 'checkUsd' ? (sortOrder === 'desc' ? '↓ Mayor a menor' : '↑ Menor a mayor') : ''}
          </button>

          <button
            className={`gtl-btn-secondary ${sortField === 'operador' ? 'active' : ''}`}
            onClick={() => handleSortClick('operador')}
          >
            Nombre (A-Z) {sortField === 'operador' ? (sortOrder === 'asc' ? '↑ A-Z' : '↓ Z-A') : ''}
          </button>

          <button
            className={`gtl-btn-secondary ${sortField === 'teamLeader' ? 'active' : ''}`}
            onClick={() => handleSortClick('teamLeader')}
          >
            Team Leader (A-Z) {sortField === 'teamLeader' ? (sortOrder === 'asc' ? '↑ A-Z' : '↓ Z-A') : ''}
          </button>

          <button
            className={`gtl-btn-secondary ${sortField === 'rechazos' ? 'active' : ''}`}
            onClick={() => handleSortClick('rechazos')}
          >
            Rechazos {sortField === 'rechazos' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
          </button>

          <button
            className={`gtl-btn-secondary ${sortField === 'trash' ? 'active' : ''}`}
            onClick={() => handleSortClick('trash')}
          >
            Trash {sortField === 'trash' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
          </button>

          <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
            💡 Haz clic en cualquier operador para ver su detalle individual
          </span>
        </div>

        <div className="gtl-table-scroll-20">
          <table className="gtl-table">
            <thead>
              <tr>
                <th>Team Leader</th>
                <th>Operador</th>
                <th>Usuario</th>
                <th>País</th>
                <th>Leads</th>
                <th>Approve (Ventas)</th>
                <th>% Aprob.</th>
                <th>Reject (Rechazos)</th>
                <th>Trash</th>
                <th>Check (USD)</th>
              </tr>
            </thead>
            <tbody>
              {operatorStats.map((row) => (
                <tr
                  key={row.usuario}
                  className="clickable-row"
                  onClick={() => {
                    setSelectedOperatorCode(row.usuario);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <td
                    style={{
                      fontWeight: 700,
                      color: row.teamLeader === 'Sin asignar' ? 'var(--badge-red-text)' : 'var(--text-primary)',
                    }}
                  >
                    {row.teamLeader}
                  </td>
                  <td style={{ fontWeight: 700, textDecoration: 'underline', textDecorationColor: 'var(--accent-Warm)' }}>
                    {row.operador}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {row.usuario}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                      {(row.countries && row.countries.length > 0 ? row.countries : [row.country]).map((c) => (
                        <span
                          key={c}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-color)',
                            padding: '2px 7px',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {getFlag(c)} {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{row.leads}</td>
                  <td>
                    <span className="gtl-badge gtl-badge-green">{row.ventas}</span>
                  </td>
                  <td>
                    <span
                      className={`gtl-badge ${
                        row.approvalPct >= 30
                          ? 'gtl-badge-green'
                          : row.approvalPct >= 15
                          ? 'gtl-badge-amber'
                          : 'gtl-badge-red'
                      }`}
                    >
                      {row.approvalPct.toFixed(1)}%
                    </span>
                  </td>
                  <td>
                    {row.rechazos > 0 ? (
                      <span className="gtl-badge gtl-badge-red">
                        {row.rechazos} ({row.rejectPct.toFixed(0)}%)
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>0 (0%)</span>
                    )}
                  </td>
                  <td>
                    {row.trash > 0 ? (
                      <span className="gtl-badge gtl-badge-amber">
                        {row.trash} ({row.trashPct.toFixed(0)}%)
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>0 (0%)</span>
                    )}
                  </td>
                  <td className="gtl-check-cell">${row.checkUsd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>GRAND TOTAL ({operatorStats.length} Operadores)</td>
                <td>{viewTotals.leads}</td>
                <td>{viewTotals.ventas}</td>
                <td>{viewTotals.approvalPct.toFixed(1)}%</td>
                <td>
                  {viewTotals.rechazos} ({viewTotals.rejectPct.toFixed(0)}%)
                </td>
                <td>
                  {viewTotals.trash} ({viewTotals.trashPct.toFixed(0)}%)
                </td>
                <td className="gtl-check-cell">${viewTotals.checkUsd.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 3. GRÁFICOS VISUALES EN LA PARTE BAJA */}
      {chartItems.length > 0 && (
        <div className="gtl-charts-grid">
          <div className="gtl-card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <strong style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                📊 Distribución: Ventas vs Rechazos y Trash (Top 20)
              </strong>
              <div style={{ display: 'flex', gap: '10px', fontSize: '11px' }}>
                <span>🟢 Approve</span>
                <span>🔴 Reject</span>
                <span>🟤 Trash</span>
              </div>
            </div>

            {chartItems.map((item) => {
              const wApprove = (item.ventas / maxLeadsInChart) * 100;
              const wReject = (item.rechazos / maxLeadsInChart) * 100;
              const wTrash = (item.trash / maxLeadsInChart) * 100;

              return (
                <div
                  className="gtl-bar-row"
                  key={item.usuario}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedOperatorCode(item.usuario);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <div className="gtl-bar-label" title={item.operador}>
                    {item.operador}
                  </div>
                  <div className="gtl-bar-track">
                    <div
                      className="gtl-bar-fill-approve"
                      style={{ width: `${wApprove}%` }}
                      title={`Ventas: ${item.ventas}`}
                    />
                    <div
                      className="gtl-bar-fill-reject"
                      style={{ width: `${wReject}%` }}
                      title={`Rechazos: ${item.rechazos}`}
                    />
                    <div
                      className="gtl-bar-fill-trash"
                      style={{ width: `${wTrash}%` }}
                      title={`Trash: ${item.trash}`}
                    />
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 700 }}>
                    {item.ventas}{' '}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                      / {item.leads}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="gtl-card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
              <strong style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                💵 Comparativa de Check Promedio (USD)
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--accent-Warm)', fontWeight: 700 }}>
                Global: ${viewTotals.checkUsd.toFixed(2)}
              </span>
            </div>

            {chartItems.map((item) => {
              const wCheck = Math.min((item.checkUsd / maxCheckInChart) * 100, 100);

              return (
                <div
                  className="gtl-bar-row"
                  key={item.usuario}
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    setSelectedOperatorCode(item.usuario);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <div className="gtl-bar-label" title={item.operador}>
                    {item.operador}
                  </div>
                  <div className="gtl-bar-track">
                    <div className="gtl-bar-fill-check" style={{ width: `${wCheck}%` }} />
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 800, color: 'var(--accent-Warm)' }}>
                    ${item.checkUsd.toFixed(2)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}