import { useState, useMemo, useEffect } from 'react';
import { readExcel, fetchGoogleSheet } from './utils/readExcel';
import './App.css';

// Tipos de cambio por defecto por país (moneda local por 1 USD)
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

// Clasifica cada registro según Status y Sub Status en: approve, reject, trash o pending
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
  // Estados en gestión (Recall, No Answer, New, Processing, Hold)
  return 'pending';
}

export default function App() {
  // Tema Claro / Oscuro
  const [theme, setTheme] = useState(
    () => localStorage.getItem('gestiontl_theme') || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gestiontl_theme', theme);
  }, [theme]);

  // Bases de datos
  const [bd1Data, setBd1Data] = useState([]);
  const [bd2Data, setBd2Data] = useState([]);

  // Configuración Google Sheets
  const [sheetUrl, setSheetUrl] = useState(
    () => localStorage.getItem('gestiontl_sheet_url') || ''
  );
  const [bd1SheetName, setBd1SheetName] = useState(
    () => localStorage.getItem('gestiontl_bd1_tab') || 'BD1'
  );
  const [bd2SheetName, setBd2SheetName] = useState(
    () => localStorage.getItem('gestiontl_bd2_tab') || 'BD2'
  );
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: '', text: '' });
  const [showDataConfig, setShowDataConfig] = useState(true);
  const [showRatesConfig, setShowRatesConfig] = useState(false);

  // Tipos de cambio por país
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

  // Navegación, filtros y ordenamiento
  const [activeTab, setActiveTab] = useState('operador'); // 'campana' | 'operador' | 'tl'
  const [selectedCountry, setSelectedCountry] = useState('Todos los países');
  const [selectedTLFilter, setSelectedTLFilter] = useState('Todos los Team Leaders');
  const [searchQuery, setSearchQuery] = useState('');

  // Ordenamiento: 'ventas' | 'checkUsd' | 'operador' | 'teamLeader' | 'rechazos' | 'trash' | 'leads'
  const [sortField, setSortField] = useState('ventas');
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'

  const handleSortClick = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      // Para nombres (operador / teamLeader) por defecto A->Z ('asc'), para métricas numéricas Mayor->Menor ('desc')
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

  // Sincronización con Google Sheets
  const handleSyncGoogleSheets = async () => {
    if (!sheetUrl.trim()) {
      setStatusMessage({
        type: 'error',
        text: 'Pega primero el enlace de tu documento de Google Sheets.',
      });
      return;
    }

    try {
      setLoadingSheets(true);
      setStatusMessage({ type: '', text: '' });

      const [rowsBd1, rowsBd2] = await Promise.all([
        fetchGoogleSheet(sheetUrl, bd1SheetName),
        fetchGoogleSheet(sheetUrl, bd2SheetName),
      ]);

      setBd1Data(rowsBd1);
      setBd2Data(rowsBd2);
      setStatusMessage({
        type: 'success',
        text: `Sincronización exitosa: ${rowsBd1.length} registros en BD1 y ${rowsBd2.length} operadores en BD2.`,
      });
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error.message || 'Error al conectar con Google Sheets.',
      });
    } finally {
      setLoadingSheets(false);
    }
  };

  // Carga de Excel local
  const handleFileUpload = async (e, type) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMessage({ type: '', text: '' });
    try {
      const rows = await readExcel(file);
      if (type === 'bd1') setBd1Data(rows);
      else setBd2Data(rows);
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

  // 2. Enriquecer cada registro de BD1 con BD2, categoría de estado y conversión a USD por país
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

      const rawStatus = getRowValue(row, ['Status', 'Estado']);
      const rawSubStatus = getRowValue(row, ['Sub Status', 'SubStatus', 'Sub Estado']);
      const category = classifyStatus(rawStatus, rawSubStatus);

      const finalPriceLocal = parsePrice(
        getRowValue(row, ['Final price', 'Price', 'Precio final', 'Importe'])
      );
      const rate = getRateForCountry(country);
      const priceUsd = finalPriceLocal > 0 ? finalPriceLocal / rate : 0;

      return {
        usuario,
        operador: info ? info.operador : usuario,
        teamLeader: info ? info.teamLeader : 'Sin asignar',
        country,
        category, // 'approve' | 'reject' | 'trash' | 'pending'
        finalPriceLocal,
        priceUsd,
      };
    });
  }, [bd1Data, operatorDirectory, countryRates]);

  // Listas para filtros desplegables
  const countriesList = useMemo(() => {
    const unique = new Set(enrichedRecords.map((r) => r.country).filter(Boolean));
    return ['Todos los países', ...Array.from(unique)];
  }, [enrichedRecords]);

  const teamLeadersList = useMemo(() => {
    const unique = new Set(enrichedRecords.map((r) => r.teamLeader).filter(Boolean));
    return ['Todos los Team Leaders', ...Array.from(unique)];
  }, [enrichedRecords]);

  // 3. Aplicar filtros globales
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

  // Función auxiliar para ordenar cualquier tabla según sortField y sortOrder
  const sortCollection = (items) => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === 'string' || typeof valB === 'string') {
        const cmp = String(valA || '').localeCompare(String(valB || ''), 'es', {
          sensitivity: 'base',
        });
        return sortOrder === 'asc' ? cmp : -cmp;
      }

      const numA = Number(valA) || 0;
      const numB = Number(valB) || 0;
      if (numA === numB) {
        return (b.ventas || 0) - (a.ventas || 0);
      }
      return sortOrder === 'asc' ? numA - numB : numB - numA;
    });
    return sorted;
  };

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
      // El Check se calcula sobre las ventas aprobadas (o sobre el total si no hay distinción de estado)
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

    return sortCollection(list);
  }, [filteredRecords, sortField, sortOrder]);

  // 5. Agrupación POR TEAM LEADER
  const teamLeaderStats = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((rec) => {
      const key = rec.teamLeader;
      if (!map.has(key)) {
        map.set(key, {
          teamLeader: key,
          operador: key, // alias para cuando se ordena por nombre
          operatorsSet: new Set(),
          leads: 0,
          ventas: 0,
          rechazos: 0,
          trash: 0,
          pending: 0,
          sumApprovedUsd: 0,
          sumAllUsd: 0,
        });
      }
      const item = map.get(key);
      item.operatorsSet.add(rec.usuario);
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
        operadoresCount: item.operatorsSet.size,
        checkUsd,
        approvalPct,
        rejectPct,
        trashPct,
      };
    });

    return sortCollection(list);
  }, [filteredRecords, sortField, sortOrder]);

  // 6. Agrupación POR CAMPAÑA / PAÍS (Estilo NEW REPORT)
  const campaignStats = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((rec) => {
      const key = rec.country;
      if (!map.has(key)) {
        map.set(key, {
          country: key,
          operador: key,
          teamLeader: key,
          operatorsSet: new Set(),
          tlSet: new Set(),
          leads: 0,
          ventas: 0,
          rechazos: 0,
          trash: 0,
          pending: 0,
          sumApprovedUsd: 0,
          sumAllUsd: 0,
        });
      }
      const item = map.get(key);
      item.operatorsSet.add(rec.usuario);
      if (rec.teamLeader !== 'Sin asignar') item.tlSet.add(rec.teamLeader);
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
        operadoresCount: item.operatorsSet.size,
        tlCount: item.tlSet.size,
        checkUsd,
        approvalPct,
        rejectPct,
        trashPct,
      };
    });

    return sortCollection(list);
  }, [filteredRecords, sortField, sortOrder]);

  // Totales Globales (GRAND TOTAL)
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

  // Datos para los gráficos según la pestaña activa
  const chartItems = useMemo(() => {
    const source =
      activeTab === 'operador'
        ? operatorStats
        : activeTab === 'tl'
        ? teamLeaderStats
        : campaignStats;
    return source.slice(0, 8);
  }, [activeTab, operatorStats, teamLeaderStats, campaignStats]);

  const maxLeadsInChart = useMemo(() => {
    return Math.max(...chartItems.map((i) => i.leads || 1), 1);
  }, [chartItems]);

  const maxCheckInChart = useMemo(() => {
    return Math.max(...chartItems.map((i) => i.checkUsd || 1), 100);
  }, [chartItems]);

  const getFlag = (countryName) => {
    const clean = String(countryName || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();
    return COUNTRY_FLAGS[clean] || '🌎';
  };

  return (
    <div className="gtl-container">
      {/* CABECERA EJECUTIVA */}
      <header className="gtl-header">
        <div className="gtl-brand">
          <span className="gtl-brand-badge">GESTION TL</span>
          <div>
            <h1 className="gtl-title">Panel Ejecutivo de Operaciones</h1>
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
            className="gtl-btn-secondary"
            onClick={() => setShowRatesConfig((v) => !v)}
          >
            💱 Tipos de Cambio
          </button>

          <button
            className="gtl-btn-secondary"
            onClick={() => setShowDataConfig((v) => !v)}
          >
            {showDataConfig ? '▲ Ocultar Carga' : '▼ Cargar Datos'}
          </button>

          <button
            className="gtl-theme-btn"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro'}
          </button>
        </div>
      </header>

      {/* PANEL DESPLEGABLE: TIPOS DE CAMBIO POR CAMPAÑA */}
      {showRatesConfig && (
        <div className="gtl-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <strong style={{ fontSize: '14px' }}>
              💱 Configuración de Tipo de Cambio por País (Moneda Local por 1 USD)
            </strong>
            <button
              className="gtl-btn-secondary"
              onClick={() => setCountryRates(DEFAULT_RATES)}
            >
              Restaurar valores por defecto
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px' }}>
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
        </div>
      )}

      {/* PANEL DESPLEGABLE: SINCRONIZACIÓN CON GOOGLE SHEETS Y EXCEL */}
      {showDataConfig && (
        <div className="gtl-card">
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '10px', alignItems: 'end', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: 700 }}>
                ENLACE DE GOOGLE SHEETS (ACCESO: CUALQUIER PERSONA CON EL ENLACE)
              </label>
              <input
                type="text"
                className="gtl-input"
                placeholder="https://docs.google.com/spreadsheets/d/..."
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
              onClick={handleSyncGoogleSheets}
              disabled={loadingSheets}
            >
              {loadingSheets ? 'Sincronizando...' : 'Sincronizar Google Sheets'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>
                📂 BD1 Local (Opcional): <strong style={{ color: 'var(--accent-Warm)' }}>{bd1Data.length} filas</strong>
              </span>
              <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => handleFileUpload(e, 'bd1')} style={{ fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>
                📂 BD2 Local (Opcional): <strong style={{ color: 'var(--accent-Warm)' }}>{operatorDirectory.size} operadores</strong>
              </span>
              <input type="file" accept=".xls,.xlsx,.csv" onChange={(e) => handleFileUpload(e, 'bd2')} style={{ fontSize: '12px' }} />
            </div>
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

      {/* TARJETAS DE INDICADORES CLAVE (KPIs) */}
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
          <div className="gtl-kpi-sub">{globalTotals.rejectPct.toFixed(1)}% del total</div>
        </div>

        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Trash / Basura</div>
          <div className="gtl-kpi-value" style={{ color: 'var(--badge-amber-text)' }}>
            {globalTotals.trash}
          </div>
          <div className="gtl-kpi-sub">{globalTotals.trashPct.toFixed(1)}% del total</div>
        </div>

        <div className="gtl-kpi-card">
          <div className="gtl-kpi-label">Check Promedio (USD)</div>
          <div className="gtl-kpi-value" style={{ color: 'var(--accent-Warm)' }}>
            ${globalTotals.checkUsd.toFixed(2)}
          </div>
          <div className="gtl-kpi-sub">Ticket promedio en dólares</div>
        </div>
      </div>

      {/* GRÁFICOS VISUALES DE BARRAS */}
      {chartItems.length > 0 && (
        <div className="gtl-charts-grid">
          {/* Gráfico 1: Volumen de Ventas, Rechazos y Trash */}
          <div className="gtl-card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <strong style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                📊 Distribución: Ventas vs Rechazos y Trash (Top 8)
              </strong>
              <div style={{ display: 'flex', gap: '10px', fontSize: '11px' }}>
                <span>🟢 Approve</span>
                <span>🔴 Reject</span>
                <span>🟤 Trash</span>
              </div>
            </div>

            {chartItems.map((item, idx) => {
              const label =
                activeTab === 'operador'
                  ? item.operador
                  : activeTab === 'tl'
                  ? item.teamLeader
                  : `${getFlag(item.country)} ${item.country}`;
              const wApprove = (item.ventas / maxLeadsInChart) * 100;
              const wReject = (item.rechazos / maxLeadsInChart) * 100;
              const wTrash = (item.trash / maxLeadsInChart) * 100;

              return (
                <div className="gtl-bar-row" key={idx}>
                  <div className="gtl-bar-label" title={label}>
                    {label}
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
                    {item.ventas} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {item.leads}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gráfico 2: Comparativa de Check (USD) */}
          <div className="gtl-card" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <strong style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                💵 Comparativa de Check Promedio (USD)
              </strong>
              <span style={{ fontSize: '11px', color: 'var(--accent-Warm)', fontWeight: 700 }}>
                Global: ${globalTotals.checkUsd.toFixed(2)}
              </span>
            </div>

            {chartItems.map((item, idx) => {
              const label =
                activeTab === 'operador'
                  ? item.operador
                  : activeTab === 'tl'
                  ? item.teamLeader
                  : `${getFlag(item.country)} ${item.country}`;
              const wCheck = Math.min((item.checkUsd / maxCheckInChart) * 100, 100);

              return (
                <div className="gtl-bar-row" key={idx}>
                  <div className="gtl-bar-label" title={label}>
                    {label}
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

      {/* PESTAÑAS DE VISTA */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
        <div className="gtl-tabs">
          <button
            className={`gtl-tab ${activeTab === 'campana' ? 'active' : ''}`}
            onClick={() => setActiveTab('campana')}
          >
            🌎 Por Campaña / País ({campaignStats.length})
          </button>
          <button
            className={`gtl-tab ${activeTab === 'operador' ? 'active' : ''}`}
            onClick={() => setActiveTab('operador')}
          >
            🎧 Por Operador ({operatorStats.length})
          </button>
          <button
            className={`gtl-tab ${activeTab === 'tl' ? 'active' : ''}`}
            onClick={() => setActiveTab('tl')}
          >
            👔 Por Team Leader ({teamLeaderStats.length})
          </button>
        </div>
      </div>

      {/* CONTENEDOR DE FILTROS, BOTONES DE ORDENAMIENTO Y TABLA */}
      <div className="gtl-card">
        {/* Barra de Búsqueda + Filtros + Botones de Ordenamiento */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '14px' }}>
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

        {/* Botones de Ordenamiento Dinámico (Menor a Mayor / Mayor a Menor) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '10px 12px',
            background: 'var(--bg-elevated)',
            borderRadius: '8px',
            marginBottom: '18px',
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
        </div>

        {/* TABLA 1: POR OPERADOR */}
        {activeTab === 'operador' && (
          <div className="gtl-table-wrap">
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
                  <tr key={row.usuario}>
                    <td
                      style={{
                        fontWeight: 700,
                        color: row.teamLeader === 'Sin asignar' ? 'var(--badge-red-text)' : 'var(--text-primary)',
                      }}
                    >
                      {row.teamLeader}
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.operador}</td>
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
                          row.approvalPct >= 30 ? 'gtl-badge-green' : row.approvalPct >= 15 ? 'gtl-badge-amber' : 'gtl-badge-red'
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
        )}

        {/* TABLA 2: POR TEAM LEADER */}
        {activeTab === 'tl' && (
          <div className="gtl-table-wrap">
            <table className="gtl-table">
              <thead>
                <tr>
                  <th>Team Leader</th>
                  <th>Operadores Activos</th>
                  <th>Leads</th>
                  <th>Approve (Ventas)</th>
                  <th>% Aprob.</th>
                  <th>Reject (Rechazos)</th>
                  <th>Trash</th>
                  <th>Check (USD)</th>
                </tr>
              </thead>
              <tbody>
                {teamLeaderStats.map((row) => (
                  <tr key={row.teamLeader}>
                    <td
                      style={{
                        fontWeight: 700,
                        color: row.teamLeader === 'Sin asignar' ? 'var(--badge-red-text)' : 'var(--text-primary)',
                      }}
                    >
                      {row.teamLeader}
                    </td>
                    <td style={{ fontWeight: 600 }}>{row.operadoresCount}</td>
                    <td style={{ fontWeight: 600 }}>{row.leads}</td>
                    <td>
                      <span className="gtl-badge gtl-badge-green">{row.ventas}</span>
                    </td>
                    <td>
                      <span
                        className={`gtl-badge ${
                          row.approvalPct >= 30 ? 'gtl-badge-green' : row.approvalPct >= 15 ? 'gtl-badge-amber' : 'gtl-badge-red'
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
                  <td>GRAND TOTAL</td>
                  <td>{globalTotals.operadores}</td>
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
        )}

        {/* TABLA 3: POR CAMPAÑA / PAÍS (Estilo NEW REPORT) */}
        {activeTab === 'campana' && (
          <div className="gtl-table-wrap">
            <table className="gtl-table">
              <thead>
                <tr>
                  <th>Country / Campaña</th>
                  <th>Team Leaders</th>
                  <th>Operadores</th>
                  <th>Leads</th>
                  <th>Approve (Ventas)</th>
                  <th>% Aprob.</th>
                  <th>Reject (%)</th>
                  <th>Trash (%)</th>
                  <th>AVG Price / Check (USD)</th>
                </tr>
              </thead>
              <tbody>
                {campaignStats.map((row) => (
                  <tr key={row.country}>
                    <td style={{ fontWeight: 700 }}>
                      {getFlag(row.country)} {row.country}
                    </td>
                    <td>{row.tlCount}</td>
                    <td>{row.operadoresCount}</td>
                    <td style={{ fontWeight: 600 }}>{row.leads}</td>
                    <td>
                      <span className="gtl-badge gtl-badge-green">{row.ventas}</span>
                    </td>
                    <td>
                      <span
                        className={`gtl-badge ${
                          row.approvalPct >= 30 ? 'gtl-badge-green' : row.approvalPct >= 15 ? 'gtl-badge-amber' : 'gtl-badge-red'
                        }`}
                      >
                        {row.approvalPct.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      {row.rechazos} ({row.rejectPct.toFixed(0)}%)
                    </td>
                    <td>
                      {row.trash} ({row.trashPct.toFixed(0)}%)
                    </td>
                    <td className="gtl-check-cell">${row.checkUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>GRAND TOTAL</td>
                  <td>{globalTotals.teamLeaders}</td>
                  <td>{globalTotals.operadores}</td>
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
        )}
      </div>
    </div>
  );
}