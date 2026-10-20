import { useState, useMemo, useEffect } from 'react';
import { readExcel, fetchGoogleSheet } from './utils/readExcel';
import './App.css';

// ENLACE AUTOMÁTICO DE GOOGLE SHEETS
// (Si ya lo sincronizaste una vez en tu navegador, se toma automáticamente de tu memoria local;
// también puedes pegar aquí tu link de 1rc586X_ibh0v3q79aaRE... para dejarlo fijo en el código)
const DEFAULT_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1RLIyRwIuMcqxDhictdn4U30bYNNaLa1LdszB4PILV-U/edit?gid=958277312#gid=958277312';

const DEFAULT_RATES = {
  CHILE: 980.39,
  COLOMBIA: 4200.0,
  'COSTA RICA': 515.0,
  ECUADOR: 1.0,
  MEXICO: 19.8,
  PSMEXICO: 19.8,
  PARAGUAY: 7800.0,
  PERU: 3.75,
  URUGUAY: 41.5,
  DEFAULT: 980.39,
};

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

function cleanOperatorCode(rawCode) {
  if (!rawCode) return '';
  return String(rawCode).replace(/\s+/g, '').trim().toUpperCase();
}

function getRowValue(row, possibleKeys) {
  if (!row) return '';
  const rowKeys = Object.keys(row);
  for (const candidate of possibleKeys) {
    const foundKey = rowKeys.find(
      (k) => normalizeText(k) === normalizeText(candidate)
    );
    if (foundKey !== undefined && row[foundKey] !== undefined && row[foundKey] !== '') {
      return row[foundKey];
    }
  }
  return '';
}

function findOperatorCodeInRow(row, preferredKeys) {
  if (!row) return '';
  const byKey = getRowValue(row, preferredKeys);
  if (byKey && /[A-Z0-9]+-\d+/i.test(String(byKey))) {
    return cleanOperatorCode(byKey);
  }
  for (const val of Object.values(row)) {
    const str = String(val || '').trim();
    if (/^(PEROP|COLOP|MEXOP|ECUOP|[A-Z]{3,8}[0-9A-Z]*-\d+)$/i.test(str)) {
      return cleanOperatorCode(str);
    }
  }
  return cleanOperatorCode(byKey);
}

function parsePrice(rawPrice) {
  if (typeof rawPrice === 'number') return Number.isFinite(rawPrice) ? rawPrice : 0;
  if (!rawPrice) return 0;
  const str = String(rawPrice).trim();
  const cleaned = str
    .replace(/[^\d.,-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function classifyStatus(rawStatus, rawSubStatus) {
  const st = normalizeText(`${rawStatus || ''} ${rawSubStatus || ''}`);
  if (!st || st.includes('approv') || st.includes('aprob') || st.includes('venta') || st.includes('confirm')) {
    return 'approve';
  }
  if (
    st.includes('trash') ||
    st.includes('basura') ||
    st.includes('spam') ||
    st.includes('duplic') ||
    st.includes('test') ||
    st.includes('invalid') ||
    st.includes('fake')
  ) {
    return 'trash';
  }
  if (
    st.includes('reject') ||
    st.includes('rechaz') ||
    st.includes('cancel') ||
    st.includes('anulad') ||
    st.includes('deneg')
  ) {
    return 'reject';
  }
  return 'pending';
}

export default function App() {
  // Tema Claro / Oscuro (Por defecto 'light' como en tu captura)
  const [theme, setTheme] = useState(
    () => localStorage.getItem('gestiontl_theme') || 'light'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gestiontl_theme', theme);
  }, [theme]);

  // Sidebar retráctil y menú móvil
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Drill-down: Operador seleccionado para ver su reporte individual
  const [selectedOperatorCode, setSelectedOperatorCode] = useState(null);

  // Bases de datos (con respaldo en caché local para carga instantánea)
  const [bd1Data, setBd1Data] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gestiontl_cache_bd1') || '[]');
    } catch {
      return [];
    }
  });
  const [bd2Data, setBd2Data] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gestiontl_cache_bd2') || '[]');
    } catch {
      return [];
    }
  });

  // Configuración de Google Sheets (oculta y automática)
  const [sheetUrl, setSheetUrl] = useState(
    () => localStorage.getItem('gestiontl_sheet_url') || DEFAULT_SHEET_URL
  );
  const [bd1SheetName, setBd1SheetName] = useState(
    () => localStorage.getItem('gestiontl_bd1_tab') || 'BD1'
  );
  const [bd2SheetName, setBd2SheetName] = useState(
    () => localStorage.getItem('gestiontl_bd2_tab') || 'BD2'
  );
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

  // Tipos de cambio
  const [countryRates, setCountryRates] = useState(() => {
    const saved = localStorage.getItem('gestiontl_rates');
    if (saved) {
      try {
        return { ...DEFAULT_RATES, ...JSON.parse(saved) };
      } catch {
        return DEFAULT_RATES;
      }
    }
    return DEFAULT_RATES;
  });

  useEffect(() => {
    localStorage.setItem('gestiontl_rates', JSON.stringify(countryRates));
  }, [countryRates]);

  useEffect(() => {
    localStorage.setItem('gestiontl_sheet_url', sheetUrl);
    localStorage.setItem('gestiontl_bd1_tab', bd1SheetName);
    localStorage.setItem('gestiontl_bd2_tab', bd2SheetName);
  }, [sheetUrl, bd1SheetName, bd2SheetName]);

  // Filtros y Ordenamiento
  const [selectedCountry, setSelectedCountry] = useState('Todos los países');
  const [selectedTLFilter, setSelectedTLFilter] = useState('Todos los Team Leaders');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('ventas');
  const [sortOrder, setSortOrder] = useState('desc');

  const handleSortClick = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'operador' || field === 'teamLeader' ? 'asc' : 'desc');
    }
  };

  const getRateForCountry = (countryName) => {
    const key = String(countryName || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
    const rate = Number(countryRates[key]);
    if (rate > 0) return rate;
    return Number(countryRates.DEFAULT) > 0 ? Number(countryRates.DEFAULT) : 980.39;
  };

  // CONSULTA AUTOMÁTICA E INMEDIATA A GOOGLE SHEETS AL ENTRAR
  const handleSyncGoogleSheets = async (silent = false) => {
    if (!sheetUrl.trim()) return;
    try {
      setLoadingSheets(true);
      if (!silent) setStatusMessage({ type: '', text: '' });

      let rowsBd1 = [];
      try {
        rowsBd1 = await fetchGoogleSheet(sheetUrl, bd1SheetName);
      } catch {
        const altTab = bd1SheetName === 'BD1' ? 'BD' : 'BD1';
        rowsBd1 = await fetchGoogleSheet(sheetUrl, altTab);
      }

      const rowsBd2 = await fetchGoogleSheet(sheetUrl, bd2SheetName);

      if (rowsBd1.length > 0) {
        setBd1Data(rowsBd1);
        localStorage.setItem('gestiontl_cache_bd1', JSON.stringify(rowsBd1));
      }
      if (rowsBd2.length > 0) {
        setBd2Data(rowsBd2);
        localStorage.setItem('gestiontl_cache_bd2', JSON.stringify(rowsBd2));
      }

      if (!silent) {
        setStatusMessage({
          type: 'success',
          text: `Sincronización exitosa: ${rowsBd1.length} registros en BD1 y ${rowsBd2.length} operadores en BD2.`,
        });
      }
    } catch (error) {
      if (!silent) {
        setStatusMessage({
          type: 'error',
          text: error.message || 'Error al conectar con Google Sheets.',
        });
      }
    } finally {
      setLoadingSheets(false);
    }
  };

  useEffect(() => {
    handleSyncGoogleSheets(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readExcel(file);
      if (type === 'bd1') {
        setBd1Data(rows);
        localStorage.setItem('gestiontl_cache_bd1', JSON.stringify(rows));
      } else {
        setBd2Data(rows);
        localStorage.setItem('gestiontl_cache_bd2', JSON.stringify(rows));
      }
      setStatusMessage({
        type: 'success',
        text: `Archivo ${file.name} cargado correctamente (${rows.length} filas).`,
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: `Error al leer ${file.name}: ${error.message}`,
      });
    }
  };

  // 1. Directorio de BD2
  const operatorDirectory = useMemo(() => {
    const map = new Map();
    bd2Data.forEach((row) => {
      const code = findOperatorCodeInRow(row, [
        'PEROP1AM',
        'USUARIO',
        'CODIGO',
        'CÓDIGO',
        'OPERATOR',
      ]);
      if (!code) return;

      const operatorName = String(
        getRowValue(row, ['ASESORES', 'ASESOR', 'OPERADOR', 'NOMBRE']) || code
      )
        .replace(/\s+/g, ' ')
        .trim();

      const teamLeader = String(
        getRowValue(row, ['TEAMLEADER', 'TEAM LEADER', 'TL', 'SUPERVISOR']) ||
          'Sin asignar'
      )
        .replace(/\s+/g, ' ')
        .trim();

      const campaign = String(
        getRowValue(row, ['CAMPAÑA', 'CAMPANA', 'PAIS', 'PAÍS', 'COUNTRY']) || ''
      ).trim();

      map.set(code, {
        usuario: code,
        operador: operatorName,
        teamLeader: teamLeader || 'Sin asignar',
        campaign,
      });
    });
    return map;
  }, [bd2Data]);

  // 2. Enriquecer cada registro de BD1 con BD2
  const enrichedRecords = useMemo(() => {
    return bd1Data.map((row) => {
      const usuario =
        findOperatorCodeInRow(row, [
          'Final status assigned by (operator)',
          'Operator',
          'Operador',
          'Usuario',
          'PEROP1AM',
        ]) || 'SIN_USUARIO';

      const info = operatorDirectory.get(usuario);

      const rawCountry = getRowValue(row, ['Country', 'Pais', 'País', 'Campaña']);
      const country = String(rawCountry || info?.campaign || 'Chile').trim();

      const rawStatus = String(getRowValue(row, ['Status', 'Estado']) || 'Approved').trim();
      const rawSubStatus = String(getRowValue(row, ['Sub Status', 'SubStatus', 'Sub Estado']) || '').trim();
      const category = classifyStatus(rawStatus, rawSubStatus);

      const finalPriceLocal = parsePrice(
        getRowValue(row, ['Final price', 'Price', 'Precio final', 'Importe'])
      );
      const rate = getRateForCountry(country);
      const priceUsd = finalPriceLocal > 0 ? finalPriceLocal / rate : 0;

      const orderNumber = getRowValue(row, ['Number', 'Index by partner', 'Orden', 'ID']);
      const dateCrm = getRowValue(row, ['Date of creation in CRM', 'Date', 'Fecha']);
      const products = getRowValue(row, ['Products', 'Product lead', 'Producto']);

      return {
        usuario,
        operador: info ? info.operador : usuario,
        teamLeader: info ? info.teamLeader : 'Sin asignar',
        country,
        rawStatus,
        rawSubStatus,
        category,
        finalPriceLocal,
        priceUsd,
        orderNumber,
        dateCrm,
        products,
      };
    });
  }, [bd1Data, operatorDirectory, countryRates]);

  // Listas desplegables
  const countriesList = useMemo(() => {
    const unique = new Set(enrichedRecords.map((r) => r.country).filter(Boolean));
    return ['Todos los países', ...Array.from(unique)];
  }, [enrichedRecords]);

  const teamLeadersList = useMemo(() => {
    const unique = new Set(enrichedRecords.map((r) => r.teamLeader).filter(Boolean));
    return ['Todos los Team Leaders', ...Array.from(unique)];
  }, [enrichedRecords]);

  // 3. Filtrar registros
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

  // 4. Agrupación POR OPERADOR
  const operatorStats = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((rec) => {
      if (!map.has(rec.usuario)) {
        map.set(rec.usuario, {
          teamLeader: rec.teamLeader,
          operador: rec.operador,
          usuario: rec.usuario,
          country: rec.country,
          leads: 0,
          ventas: 0,
          rechazos: 0,
          trash: 0,
          pending: 0,
          sumApprovedUsd: 0,
          sumAllUsd: 0,
        });
      }
      const item = map.get(rec.usuario);
      item.leads += 1;
      item.sumAllUsd += rec.priceUsd;

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
      const checkUsd =
        item.ventas > 0
          ? item.sumApprovedUsd / item.ventas
          : item.leads > 0
          ? item.sumAllUsd / item.leads
          : 0;
      const approvalPct = item.leads > 0 ? (item.ventas / item.leads) * 100 : 0;
      const rejectPct = item.leads > 0 ? (item.rechazos / item.leads) * 100 : 0;
      const trashPct = item.leads > 0 ? (item.trash / item.leads) * 100 : 0;

      return {
        ...item,
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

  // Totales Globales (KPIs)
  const globalTotals = useMemo(() => {
    let leads = 0;
    let ventas = 0;
    let rechazos = 0;
    let trash = 0;
    let pending = 0;
    let sumApprovedUsd = 0;
    let sumAllUsd = 0;
    const opsSet = new Set();
    const tlSet = new Set();

    filteredRecords.forEach((r) => {
      leads += 1;
      sumAllUsd += r.priceUsd;
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

    const checkUsd =
      ventas > 0 ? sumApprovedUsd / ventas : leads > 0 ? sumAllUsd / leads : 0;
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

  // Datos para los gráficos en la parte baja (hasta 20 operadores)
  const chartItems = useMemo(() => operatorStats.slice(0, 20), [operatorStats]);

  const maxLeadsInChart = useMemo(
    () => Math.max(...chartItems.map((i) => i.leads || 1), 1),
    [chartItems]
  );

  const maxCheckInChart = useMemo(
    () => Math.max(...chartItems.map((i) => i.checkUsd || 1), 100),
    [chartItems]
  );

  const getFlag = (countryName) => {
    const clean = String(countryName || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
    return COUNTRY_FLAGS[clean] || '🌎';
  };

  // Operador activo en vista Drill-down
  const activeOperatorDetail = useMemo(() => {
    if (!selectedOperatorCode) return null;
    const stats = operatorStats.find((o) => o.usuario === selectedOperatorCode);
    const records = enrichedRecords.filter((r) => r.usuario === selectedOperatorCode);
    return { stats, records };
  }, [selectedOperatorCode, operatorStats, enrichedRecords]);

  return (
    <div className="gtl-layout">
      {/* Overlay oscuro para celulares */}
      <div
        className={`gtl-sidebar-overlay ${mobileMenuOpen ? 'active' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      {/* SIDEBAR RETRÁCTIL */}
      <aside
        className={`gtl-sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${
          mobileMenuOpen ? 'mobile-open' : ''
        }`}
      >
        <div className="gtl-sidebar-top">
          <div className="gtl-sidebar-brand">
            <span className="gtl-sidebar-badge">GTL</span>
            <span className="gtl-sidebar-title">GESTION TL</span>
          </div>
          <button
            className="gtl-collapse-btn"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'Expandir Sidebar' : 'Contraer Sidebar'}
          >
            {sidebarCollapsed ? '▶' : '◀'}
          </button>
        </div>

        <nav className="gtl-sidebar-nav">
          <div
            className={`gtl-nav-item ${!showConfigModal ? 'active' : ''}`}
            onClick={() => {
              setSelectedOperatorCode(null);
              setShowConfigModal(false);
              setMobileMenuOpen(false);
            }}
            title="Operadores"
          >
            <div className="gtl-nav-item-left">
              <span>🎧</span>
              <span className="gtl-nav-text">Operadores</span>
            </div>
            <span className="gtl-nav-count">{operatorStats.length}</span>
          </div>
        </nav>

        {/* Parte baja del Sidebar: Estado de sincronización y Botón de Configuración */}
        <div className="gtl-sidebar-footer">
          <div className="gtl-sync-status">
            <span>{loadingSheets ? '⏳' : '🟢'}</span>
            <span>
              {loadingSheets
                ? 'Actualizando datos...'
                : `${bd1Data.length} filas sincronizadas`}
            </span>
          </div>

          <div
            className="gtl-nav-item"
            onClick={() => {
              handleSyncGoogleSheets(false);
              setMobileMenuOpen(false);
            }}
            title="Refrescar datos de Google Sheets ahora"
          >
            <div className="gtl-nav-item-left">
              <span>🔄</span>
              <span className="gtl-nav-text">Actualizar Datos</span>
            </div>
          </div>

          <div
            className={`gtl-nav-item ${showConfigModal ? 'active' : ''}`}
            onClick={() => {
              setShowConfigModal((v) => !v);
              setMobileMenuOpen(false);
            }}
            title="Configuración y Tipos de Cambio"
          >
            <div className="gtl-nav-item-left">
              <span>⚙️</span>
              <span className="gtl-nav-text">Configuración</span>
            </div>
          </div>
        </div>
      </aside>

      {/* CONTENIDO PRINCIPAL ADAPTABLE AL 100% */}
      <main className="gtl-main">
        {/* CABECERA EJECUTIVA */}
        <header className="gtl-header">
          <div className="gtl-brand">
            <button
              className="gtl-mobile-btn"
              onClick={() => setMobileMenuOpen(true)}
              title="Abrir menú"
            >
              ☰
            </button>
            <span className="gtl-brand-badge">GESTION TL</span>
            <div>
              <h1 className="gtl-title">Panel Operativo</h1>
              <p className="gtl-subtitle">
                Control de Ventas (Approve), Rechazos, Trash y Check Promedio (USD)
              </p>
            </div>
          </div>

          <div className="gtl-header-actions">
            <span className="gtl-pill">
              {globalTotals.leads} Leads | Check Global: ${globalTotals.checkUsd.toFixed(2)} USD
            </span>

            <button
              className="gtl-theme-btn"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro'}
            </button>
          </div>
        </header>

        {/* PANEL DE CONFIGURACIÓN (Solo se abre si tocas "Configuración" abajo en el Sidebar) */}
        {showConfigModal && (
          <div className="gtl-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <strong style={{ fontSize: '14px', textTransform: 'uppercase' }}>
                ⚙️ Configuración de Conexión Automática y Tipos de Cambio
              </strong>
              <button
                className="gtl-btn-secondary"
                onClick={() => setShowConfigModal(false)}
              >
                ✕ Cerrar
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', alignItems: 'end', marginBottom: '16px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
                  ENLACE DE GOOGLE SHEETS (SE CONSULTA AUTOMÁTICAMENTE AL ABRIR LA WEB)
                </label>
                <input
                  type="text"
                  className="gtl-input"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
                  PESTAÑA VENTAS (BD1)
                </label>
                <input
                  type="text"
                  className="gtl-input"
                  value={bd1SheetName}
                  onChange={(e) => setBd1SheetName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
                  PESTAÑA EQUIPO (BD2)
                </label>
                <input
                  type="text"
                  className="gtl-input"
                  value={bd2SheetName}
                  onChange={(e) => setBd2SheetName(e.target.value)}
                />
              </div>
              <button
                className="gtl-btn-primary"
                onClick={() => handleSyncGoogleSheets(false)}
                disabled={loadingSheets}
              >
                {loadingSheets ? 'Sincronizando...' : 'Guardar y Sincronizar'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', padding: '12px 0', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', marginBottom: '14px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  📂 Subir BD1 Local (Opcional): <strong style={{ color: 'var(--accent-Warm)' }}>{bd1Data.length} filas</strong>
                </span>
                <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => handleFileUpload(e, 'bd1')} style={{ fontSize: '12px' }} />
              </div>
              <div>
                <span style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  📂 Subir BD2 Local (Opcional): <strong style={{ color: 'var(--accent-Warm)' }}>{operatorDirectory.size} operadores</strong>
                </span>
                <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => handleFileUpload(e, 'bd2')} style={{ fontSize: '12px' }} />
              </div>
            </div>

            {/* Tipos de Cambio */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <strong style={{ fontSize: '13px' }}>💱 Tipos de Cambio por País (Moneda Local / 1 USD)</strong>
              <button className="gtl-btn-secondary" onClick={() => setCountryRates(DEFAULT_RATES)}>
                Restaurar por defecto
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
              {Object.keys(DEFAULT_RATES)
                .filter((k) => k !== 'DEFAULT')
                .map((countryKey) => (
                  <div key={countryKey}>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
                      {getFlag(countryKey)} {countryKey}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      className="gtl-input"
                      value={countryRates[countryKey] ?? ''}
                      onChange={(e) =>
                        setCountryRates((prev) => ({
                          ...prev,
                          [countryKey]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
            </div>

            {statusMessage.text && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  background: statusMessage.type === 'error' ? 'var(--badge-red-bg)' : 'var(--badge-green-bg)',
                  color: statusMessage.type === 'error' ? 'var(--badge-red-text)' : 'var(--badge-green-text)',
                }}
              >
                {statusMessage.text}
              </div>
            )}
          </div>
        )}

        {/* ==================================================================== */}
        {/* VISTA DRILL-DOWN: PERFIL PERSONALIZADO DE UN OPERADOR                */}
        {/* ==================================================================== */}
        {selectedOperatorCode && activeOperatorDetail?.stats ? (
          <div>
            <button
              className="gtl-btn-secondary"
              style={{ marginBottom: '18px', padding: '10px 16px', fontSize: '13px', fontWeight: 700 }}
              onClick={() => setSelectedOperatorCode(null)}
            >
              ← Volver a la Tabla General de Operadores
            </button>

            {/* Encabezado del Operador */}
            <div className="gtl-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <span className="gtl-pill" style={{ fontSize: '11px', marginBottom: '8px', display: 'inline-block' }}>
                  USUARIO: {activeOperatorDetail.stats.usuario}
                </span>
                <h2 style={{ margin: '6px 0 4px', fontSize: '24px', fontWeight: 800 }}>
                  {activeOperatorDetail.stats.operador}
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Team Leader: <strong>{activeOperatorDetail.stats.teamLeader}</strong> | Campaña: <strong>{getFlag(activeOperatorDetail.stats.country)} {activeOperatorDetail.stats.country}</strong>
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

            {/* Tabla de todas las órdenes gestionadas por este operador */}
            <div className="gtl-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <strong style={{ fontSize: '14px', textTransform: 'uppercase' }}>
                  📋 Ordenes tocadas por el operador {activeOperatorDetail.stats.operador} ({activeOperatorDetail.records.length} ordenes)
                </strong>
              </div>
              <div className="gtl-table-scroll-20">
                <table className="gtl-table">
                  <thead>
                    <tr>
                      <th>N°</th>
                      <th>N° Orden</th>
                      <th>País</th>
                      <th>Producto</th>
                      <th>Estado CRM</th>
                      <th>Clasificación</th>
                      <th>Precio Local</th>
                      <th>Check (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOperatorDetail.records.map((rec, idx) => (
                      <tr key={idx}>
                        <td>                        </td>
                        <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {rec.orderNumber || `#${idx + 1}`}
                        </td>
                        <td>
                          {getFlag(rec.country)} {rec.country}
                        </td>
                        <td style={{ maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={rec.products}>
                          {rec.products || '-'}
                        </td>
                        <td>{rec.rawStatus}</td>
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
                        <td style={{ fontWeight: 600 }}>
                          {rec.finalPriceLocal.toLocaleString()}
                        </td>
                        <td className="gtl-check-cell">${rec.priceUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* ==================================================================== */
          /* VISTA PRINCIPAL DE OPERADORES:                                       */
          /* 1. KPIs -> 2. Filtros y Tabla (20 ops) -> 3. Gráficos en parte baja  */
          /* ==================================================================== */
          <>
            {/* 1. TARJETAS DE INDICADORES CLAVE (KPIs) */}
            <div className="gtl-kpi-grid">
              <div className="gtl-kpi-card">
                <div className="gtl-kpi-label">Total Leads</div>
                <div className="gtl-kpi-value">{globalTotals.leads}</div>
                <div className="gtl-kpi-sub">
                  {globalTotals.operadores} operadores | {globalTotals.teamLeaders} TLs
                </div>
              </div>

              <div className="gtl-kpi-card">
                <div className="gtl-kpi-label">Ventas (Approve)</div>
                <div className="gtl-kpi-value" style={{ color: 'var(--badge-green-text)' }}>
                  {globalTotals.ventas}
                </div>
                <div className="gtl-kpi-sub">
                  {globalTotals.approvalPct.toFixed(1)}% de conversión
                </div>
              </div>

              <div className="gtl-kpi-card">
                <div className="gtl-kpi-label">Rechazos (Reject)</div>
                <div className="gtl-kpi-value" style={{ color: 'var(--badge-red-text)' }}>
                  {globalTotals.rechazos}
                </div>
                <div className="gtl-kpi-sub">
                  {globalTotals.rejectPct.toFixed(1)}% del total
                </div>
              </div>

              <div className="gtl-kpi-card">
                <div className="gtl-kpi-label">Trash / Basura</div>
                <div className="gtl-kpi-value" style={{ color: 'var(--badge-amber-text)' }}>
                  {globalTotals.trash}
                </div>
                <div className="gtl-kpi-sub">
                  {globalTotals.trashPct.toFixed(1)}% del total
                </div>
              </div>

              <div className="gtl-kpi-card">
                <div className="gtl-kpi-label">Check Promedio (USD)</div>
                <div className="gtl-kpi-value" style={{ color: 'var(--accent-Warm)' }}>
                  ${globalTotals.checkUsd.toFixed(2)}
                </div>
                <div className="gtl-kpi-sub">Ticket promedio en dólares</div>
              </div>
            </div>

            {/* 2. CONTENEDOR DE FILTROS, ORDENAMIENTO Y TABLA DE OPERADORES (PRIMERO) */}
            <div className="gtl-card">
              {/* Barra de Búsqueda y Filtros */}
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

              {/* Botones de Ordenamiento Dinámico */}
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

              {/* TABLA DE OPERADORES (Tamaño amplio para ~20 operadores en vista) */}
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
                          {getFlag(row.country)} {row.country}
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
                      <td>{globalTotals.leads}</td>
                      <td>{globalTotals.ventas}</td>
                      <td>{globalTotals.approvalPct.toFixed(1)}%</td>
                      <td>
                        {globalTotals.rechazos} ({globalTotals.rejectPct.toFixed(0)}%)
                      </td>
                      <td>
                        {globalTotals.trash} ({globalTotals.trashPct.toFixed(0)}%)
                      </td>
                      <td className="gtl-check-cell">${globalTotals.checkUsd.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* 3. GRÁFICOS VISUALES EN LA PARTE BAJA (DESPUÉS DE LA TABLA) */}
            {chartItems.length > 0 && (
              <div className="gtl-charts-grid">
                {/* Gráfico 1: Volumen de Ventas, Rechazos y Trash */}
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

                {/* Gráfico 2: Comparativa de Check (USD) */}
                <div className="gtl-card" style={{ marginBottom: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                    <strong style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      💵 Comparativa de Check Promedio (USD)
                    </strong>
                    <span style={{ fontSize: '11px', color: 'var(--accent-Warm)', fontWeight: 700 }}>
                      Global: ${globalTotals.checkUsd.toFixed(2)}
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
                          <div
                            className="gtl-bar-fill-check"
                            style={{ width: `${wCheck}%` }}
                          />
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
        )}
      </main>
    </div>
  );
}