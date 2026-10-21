import { useState, useMemo, useEffect } from 'react';
import { readExcel, fetchGoogleSheet } from './utils/readExcel';
import Operators, { getFlag } from './pages/Operators';
import './App.css';

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
  const subCode = String(rawSubStatus || '').match(/\b(501|503|505|508|517|527|534|535|601|602|607|612|613|614|616)\b/);
  if (subCode) {
    return subCode[1].startsWith('5') ? 'reject' : 'trash';
  }
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
  const [theme, setTheme] = useState(
    () => localStorage.getItem('gestiontl_theme') || 'light'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gestiontl_theme', theme);
  }, [theme]);

  // Navegación del Sidebar y Vistas
  const [activeView, setActiveView] = useState('operadores');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [selectedOperatorCode, setSelectedOperatorCode] = useState(null);

  // Bases de datos
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

  const [sheetUrl, setSheetUrl] = useState(() => {
    const saved = localStorage.getItem('gestiontl_sheet_url');
    if (!saved || saved.includes('1RLIyRwIuMcqxDhictdn4U30bYNNaLa1LdszB4PILV-U')) {
      return DEFAULT_SHEET_URL;
    }
    return saved;
  });
  const [bd1SheetName, setBd1SheetName] = useState(
    () => localStorage.getItem('gestiontl_bd1_tab') || 'BD1'
  );
  const [bd2SheetName, setBd2SheetName] = useState(
    () => localStorage.getItem('gestiontl_bd2_tab') || 'BD2'
  );
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });

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

  // 2. Registros enriquecidos de BD1
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
      const comment = String(getRowValue(row, ['Comment', 'Comentario', 'Comentarios', 'Observacion']) || '').trim();

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
        comment,
      };
    });
  }, [bd1Data, operatorDirectory, countryRates]);

  // Resumen para el Header superior
  const headerSummary = useMemo(() => {
    let ventas = 0;
    let sumApprovedUsd = 0;
    const opsSet = new Set();

    enrichedRecords.forEach((r) => {
      opsSet.add(r.usuario);
      if (r.category === 'approve') {
        ventas += 1;
        sumApprovedUsd += r.priceUsd;
      }
    });

    return {
      leads: enrichedRecords.length,
      operadoresCount: opsSet.size,
      checkUsd: ventas > 0 ? sumApprovedUsd / ventas : 0,
    };
  }, [enrichedRecords]);

  return (
    <div className="gtl-layout">
      {/* Overlay móvil */}
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
            className={`gtl-nav-item ${activeView === 'operadores' && !showConfigModal ? 'active' : ''}`}
            onClick={() => {
              setActiveView('operadores');
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
            <span className="gtl-nav-count">{headerSummary.operadoresCount}</span>
          </div>
        </nav>

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

      {/* CONTENIDO PRINCIPAL */}
      <main className="gtl-main">
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
              {headerSummary.leads} Leads | Check Global: ${headerSummary.checkUsd.toFixed(2)} USD
            </span>

            <button
              className="gtl-theme-btn"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro'}
            </button>
          </div>
        </header>

        {/* MODAL DE CONFIGURACIÓN */}
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

        {/* RENDERIZADO MODULAR DE VISTAS */}
        {activeView === 'operadores' && (
          <Operators
            enrichedRecords={enrichedRecords}
            selectedOperatorCode={selectedOperatorCode}
            setSelectedOperatorCode={setSelectedOperatorCode}
          />
        )}
      </main>
    </div>
  );
}