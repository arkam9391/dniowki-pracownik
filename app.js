(() => {
  'use strict';

  const STORAGE_KEY = 'dniowki.entries.v1';
  const SETTINGS_KEY = 'dniowki.settings.v1';
  const ARCHIVE_STATE_KEY = 'dniowki.archive-state.v1';
  const ARCHIVE_FILENAME = 'dniowki-archiwum.json';
  const PRE_IMPORT_KEY = 'dniowki.pre-import.v1';
  const APP_VERSION = '1.2.0';
  const APP_BUILD = '2026-10-27';
  const MAX_ENTRIES = 20000;
  const KINDS = ['work', 'vacation', 'sick', 'holiday', 'child_sick'];
  const WEEKDAYS = ['NIE', 'PON', 'WT', 'ŚR', 'CZW', 'PT', 'SOB'];
  const KIND_LABELS = { work: 'Praca', vacation: 'Urlop', sick: 'Chorobowe', holiday: 'Odbiór za święto', child_sick: 'Chorobowe dziecka' };
  const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
  const ICONS = {
    work: '<svg viewBox="0 0 24 24"><path d="M4 8h16v11H4zM9 8V5h6v3M4 12h16"></path></svg>',
    vacation: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>',
    sick: '<svg viewBox="0 0 24 24"><path d="M6 8h12v12H6zM9 8V5h6v3M12 11v6M9 14h6"></path></svg>',
    holiday: '<svg viewBox="0 0 24 24"><path d="M5 6h14v14H5zM8 3v5M16 3v5M5 10h14M9 14h6"></path></svg>',
    child_sick: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.2-7-9.3A3.7 3.7 0 0 1 12 9a3.7 3.7 0 0 1 7 1.7C19 15.8 12 20 12 20zM12 10v5M9.5 12.5h5"></path></svg>'
  };

  let entries = loadEntries();
  let settings = loadSettings();
  let weekOffset = 0;
  let editingKey = null;
  let draft = null;
  let activeView = 'week';
  let calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  let statisticsYear = new Date().getFullYear();
  let vacationYear = new Date().getFullYear();
  let editingVacationKey = null;
  let highlightedEntryKey = null;
  let pendingFutureEntry = null;
  let pendingLeaveCalendarRange = null;

  const $ = (id) => document.getElementById(id);
  const editor = $('editorDialog');
  const confirmDialog = $('confirmDialog');
  const archiveDialog = $('archiveDialog');
  const importConfirmDialog = $('importConfirmDialog');
  const vacationNoteDialog = $('vacationNoteDialog');
  const manualEntryDialog = $('manualEntryDialog');
  const futureEntryConfirmDialog = $('futureEntryConfirmDialog');
  const pdfDialog = $('pdfDialog');
  const leaveRequestDialog = $('leaveRequestDialog');
  const leaveCalendarConfirmDialog = $('leaveCalendarConfirmDialog');

  function localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function dateFromKey(key) {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function startOfWeek(date) {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const distance = (value.getDay() + 6) % 7;
    value.setDate(value.getDate() - distance);
    return value;
  }

  function addDays(date, count) {
    const next = new Date(date);
    next.setDate(next.getDate() + count);
    return next;
  }

  function validTime(value) {
    return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function isValidDateKey(key) {
    return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key) && localDateKey(dateFromKey(key)) === key;
  }

  function sanitizeEntry(entry) {
    if (!entry || typeof entry !== 'object' || !isValidDateKey(entry.date) || !KINDS.includes(entry.kind)) return null;
    const clean = {
      date: entry.date,
      kind: entry.kind,
      regular: Math.max(0, Math.min(24, Number(entry.regular) || 0)),
      overtime: Math.max(0, Math.min(12, Number(entry.overtime) || 0)),
      startTime: validTime(entry.startTime) ? entry.startTime : '06:00',
      deleted: Boolean(entry.deleted)
    };
    if (typeof entry.note === 'string' && entry.note.trim()) clean.note = entry.note.slice(0, 300);
    return clean;
  }

  function sanitizeEntryMap(source) {
    const result = {};
    if (!source || typeof source !== 'object') return result;
    for (const raw of Array.isArray(source) ? source : Object.values(source)) {
      const entry = sanitizeEntry(raw);
      if (entry) result[entry.date] = entry;
    }
    return result;
  }

  function loadEntries() {
    try { return sanitizeEntryMap(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
    catch { return {}; }
  }

  let storageErrorShown = false;
  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      if (!storageErrorShown) {
        storageErrorShown = true;
        window.setTimeout(() => { storageErrorShown = false; }, 5000);
        window.alert('Nie udało się zapisać danych na urządzeniu (brak miejsca lub zapis jest zablokowany). Ostatnia zmiana może nie zostać zachowana — zapisz archiwum.');
      }
      return false;
    }
  }

  function writeArchiveState(saved, date = null) {
    return writeStorage(ARCHIVE_STATE_KEY, JSON.stringify({ saved, date }));
  }

  function roundToHalf(value) {
    return Math.round(value * 2) / 2;
  }

  function normalizeSettings(value) {
    const workdays = Array.isArray(value?.workdays)
      ? [...new Set(value.workdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [1, 2, 3, 4, 5];
    return {
      automaticEntries: value?.automaticEntries === true,
      startTime: validTime(value?.startTime) ? value.startTime : '06:00',
      regularHours: roundToHalf(Math.max(.5, Math.min(24, Number(value?.regularHours) || 8))),
      theme: ['light', 'dark', 'system'].includes(value?.theme) ? value.theme : 'system',
      employeeName: typeof value?.employeeName === 'string' ? value.employeeName.slice(0, 100) : '',
      leaveRequestPlace: typeof value?.leaveRequestPlace === 'string' ? value.leaveRequestPlace.slice(0, 80) : '',
      workdays
    };
  }

  function loadSettings() {
    try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch { return normalizeSettings({}); }
  }

  function saveEntries(markArchiveDirty = true) {
    const stored = writeStorage(STORAGE_KEY, JSON.stringify(entries));
    if (stored && markArchiveDirty) writeArchiveState(false);
    updateArchiveIndicator();
    return stored;
  }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#0b1220' : '#f3f5f8');
  }

  function saveSettings(markArchiveDirty = true) {
    const stored = writeStorage(SETTINGS_KEY, JSON.stringify(settings));
    if (stored && markArchiveDirty) writeArchiveState(false);
    applyTheme();
    updateArchiveIndicator();
    return stored;
  }

  function archiveState() {
    try {
      const state = JSON.parse(localStorage.getItem(ARCHIVE_STATE_KEY) || 'null');
      if (!state || typeof state !== 'object') return { saved: false, date: null };
      const validDate = typeof state.date === 'string' && !Number.isNaN(Date.parse(state.date));
      return { saved: Boolean(state.saved) && validDate, date: validDate ? state.date : null };
    } catch { return { saved: false, date: null }; }
  }

  function updateArchiveIndicator() {
    const state = archiveState();
    $('openArchive').classList.toggle('saved', Boolean(state.saved));
    $('openArchive').setAttribute('aria-label', state.saved ? 'Kopia zapasowa jest zapisana' : 'Kopia zapasowa wymaga zapisania');
    $('archiveDot').classList.toggle('saved', Boolean(state.saved));
    $('archiveStatus').className = 'archive-status';
    $('archiveStatus').textContent = state.saved && state.date
      ? `Ostatnie archiwum: ${new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.date))}`
      : 'Masz zmiany, które nie zostały jeszcze zapisane w pliku archiwum.';
  }

  function missingWorkdayKeys() {
    if (!settings.automaticEntries) return [];
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    const todayKey = localDateKey(todayStart);
    // Przyszłe wpisy (np. zaplanowany urlop) nie mogą przesuwać początku uzupełniania.
    const keys = Object.keys(entries).filter((key) => key <= todayKey).sort();
    let cursor = startOfWeek(todayStart);
    if (keys.length) {
      const latest = dateFromKey(keys[keys.length - 1]);
      if (latest < cursor) cursor = addDays(latest, 1);
    }
    const missing = [];
    while (cursor <= todayStart) {
      const key = localDateKey(cursor);
      if (settings.workdays.includes(cursor.getDay()) && !entries[key]) missing.push(key);
      cursor = addDays(cursor, 1);
    }
    return missing;
  }

  function generateMissingWorkdays() {
    const missing = missingWorkdayKeys();
    missing.forEach((key) => {
      entries[key] = { date: key, kind: 'work', regular: settings.regularHours, overtime: 0, startTime: settings.startTime, deleted: false };
      highlightedEntryKey = key;
    });
    if (missing.length) saveEntries();
    return missing.length > 0;
  }

  function confirmBulkAutofill() {
    const count = missingWorkdayKeys().length;
    return count <= 10 || window.confirm(`Automat doda ${count} brakujących dni pracy (od ostatniego wpisu do dziś). Kontynuować?`);
  }

  function selectedWeekStart() {
    return addDays(startOfWeek(new Date()), weekOffset * 7);
  }

  function weekEntries() {
    const start = selectedWeekStart();
    const end = addDays(start, 7);
    return Object.values(entries)
      .filter((entry) => {
        const date = dateFromKey(entry.date);
        return !entry.deleted && date >= start && date < end;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(value);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function formatRange(start) {
    const end = addDays(start, 6);
    const dayMonth = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' });
    const ending = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${dayMonth.format(start)} – ${ending.format(end)}`;
  }

  function endTime(regular, overtime, startTime = '06:00') {
    const [hours, minutesPart] = (validTime(startTime) ? startTime : '06:00').split(':').map(Number);
    const minutes = hours * 60 + minutesPart + Math.round((regular + overtime) * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function endTimeLabel(regular, overtime, startTime) {
    const [hours, minutesPart] = (validTime(startTime) ? startTime : '06:00').split(':').map(Number);
    const crossesMidnight = hours * 60 + minutesPart + Math.round((regular + overtime) * 60) >= 24 * 60;
    return `${endTime(regular, overtime, startTime)}${crossesMidnight ? ' (+1 d)' : ''}`;
  }

  function render() {
    const list = weekEntries();
    const start = selectedWeekStart();
    const total = list.reduce((sum, item) => sum + (item.kind === 'work' ? item.regular + item.overtime : 0), 0);
    const overtime = list.reduce((sum, item) => sum + (item.kind === 'work' ? item.overtime : 0), 0);
    const workDays = list.filter((item) => item.kind === 'work').length;
    document.body.classList.toggle('week-active', activeView === 'week');
    $('recordList').style.setProperty('--visible-days', Math.max(1, list.length));

    $('todayLabel').textContent = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    $('weekName').textContent = weekOffset === 0 ? 'Bieżący tydzień'
      : weekOffset === -1 ? 'Poprzedni tydzień'
      : weekOffset === 1 ? 'Przyszły tydzień'
      : weekOffset < 0 ? `${-weekOffset} tyg. temu` : `Za ${weekOffset} tyg.`;
    $('weekRange').textContent = formatRange(start);
    $('nextWeek').disabled = false;
    $('totalHours').textContent = formatNumber(total);
    $('workDays').textContent = workDays;
    $('overtimeHours').textContent = `${formatNumber(overtime)} h`;
    $('absenceDays').textContent = list.filter((item) => item.kind !== 'work').length;
    $('recordCount').textContent = list.length ? `${list.length} ${list.length === 1 ? 'wpis' : 'wpisów'}` : '';
    $('emptyState').hidden = list.length > 0;

    $('recordList').innerHTML = list.map((entry) => {
      const date = dateFromKey(entry.date);
      const isNew = entry.date === highlightedEntryKey;
      const startTime = validTime(entry.startTime) ? entry.startTime : '06:00';
      const detail = entry.kind === 'work'
        ? `${startTime}–${endTimeLabel(entry.regular, entry.overtime, startTime)}${entry.overtime ? `  •  +${formatNumber(entry.overtime)} h` : ''}`
        : 'Dzień wolny od pracy';
      const spoken = entry.kind === 'work'
        ? `, ${formatNumber(entry.regular + entry.overtime)} godz.${entry.overtime ? `, w tym ${formatNumber(entry.overtime)} nadgodz.` : ''}`
        : '';
      const hours = entry.kind === 'work' ? `<span class="hours">${formatNumber(entry.regular + entry.overtime)} h</span>` : '<span></span>';
      return `<button class="record${isNew ? ' new-entry' : ''}" type="button" data-key="${entry.date}" aria-label="${isNew ? 'Nowy wpis. ' : ''}Edytuj: ${KIND_LABELS[entry.kind]}, ${date.toLocaleDateString('pl-PL')}${spoken}">
        <span class="date-tile"><span>${WEEKDAYS[date.getDay()]}</span><strong>${date.getDate()}</strong></span>
        <span class="status-icon ${entry.kind}" aria-hidden="true">${ICONS[entry.kind]}</span>
        <span class="record-copy"><strong>${KIND_LABELS[entry.kind]}${isNew ? '<em class="new-entry-badge">Nowy</em>' : ''}</strong><span>${detail}</span></span>
        ${hours}<span class="chevron" aria-hidden="true">›</span>
      </button>`;
    }).join('');
    renderMissingDays();
    renderStatistics();
    renderVacations();
    renderCalendar();
    renderSettings();
  }

  function missingScheduledDays() {
    const days = scheduledDays();
    const start = selectedWeekStart();
    const keys = [];
    for (let index = 0; index < 7; index += 1) {
      const date = addDays(start, index);
      const key = localDateKey(date);
      if (days.includes(date.getDay()) && (!entries[key] || entries[key].deleted)) keys.push(key);
    }
    return keys;
  }

  function renderMissingDays() {
    const missing = missingScheduledDays();
    $('missingDays').hidden = missing.length === 0;
    $('missingDaysList').innerHTML = missing.map((key) => {
      const date = dateFromKey(key);
      const spoken = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
      return `<button type="button" data-add-day="${key}" aria-label="Dodaj dzień pracy: ${spoken}">${WEEKDAYS[date.getDay()]} ${date.getDate()}</button>`;
    }).join('');
  }

  function renderCalendar() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    const firstDay = new Date(year, month, 1, 12);
    const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
    const leadingBlanks = (firstDay.getDay() + 6) % 7;
    const todayKey = localDateKey(new Date());
    const cells = [];

    $('calendarMonth').textContent = MONTHS[month];
    $('calendarYear').textContent = year;

    for (let index = 0; index < leadingBlanks; index += 1) {
      cells.push('<span class="calendar-blank" aria-hidden="true"></span>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day, 12);
      const key = localDateKey(date);
      const entry = entries[key] && !entries[key].deleted ? entries[key] : null;
      const todayClass = key === todayKey ? ' today' : '';
      if (entry) {
        cells.push(`<button class="calendar-day ${entry.kind}${todayClass}" type="button" data-calendar-key="${key}" aria-label="${day} ${MONTHS[month].toLowerCase()} ${year}: ${KIND_LABELS[entry.kind]}"><span>${day}</span></button>`);
      } else {
        cells.push(`<button class="calendar-day empty${todayClass}" type="button" data-calendar-add="${key}" aria-label="Dodaj wpis: ${day} ${MONTHS[month].toLowerCase()} ${year}"><span>${day}</span></button>`);
      }
    }

    while (cells.length % 7) cells.push('<span class="calendar-blank" aria-hidden="true"></span>');
    $('calendarGrid').innerHTML = cells.join('');
  }

  function openPdfGenerator() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();
    $('pdfMonthSelect').value = `${year}-${String(month + 1).padStart(2, '0')}`;
    pdfDialog.showModal();
  }

  function openLeaveRequestGenerator() {
    const todayKey = localDateKey(new Date());
    const employeeName = settings.employeeName.trim();
    $('leaveRequestEmployee').textContent = employeeName || 'Brak danych — uzupełnij imię i nazwisko w Ustawieniach';
    $('leaveRequestPlace').value = settings.leaveRequestPlace || '';
    $('leaveRequestDate').value = todayKey;
    $('leaveRequestFrom').value = todayKey;
    $('leaveRequestTo').value = todayKey;
    $('leaveRequestYear').value = new Date().getFullYear();
    $('leaveRequestType').value = 'wypoczynkowego';
    $('leaveRequestError').textContent = '';
    leaveRequestDialog.showModal();
  }

  function prepareLeaveCalendarConfirmation(fromKey, toKey) {
    const workdays = leaveRequestWorkdays(fromKey, toKey);
    const available = workdays.filter((key) => !entries[key] || entries[key].deleted);
    const occupied = workdays.length - available.length;
    pendingLeaveCalendarRange = { fromKey, toKey, available };
    $('leaveCalendarConfirmText').textContent = available.length
      ? `Dodać urlop do kalendarza od ${leaveRequestDateLabel(fromKey)} do ${leaveRequestDateLabel(toKey)}? Liczba nowych dni roboczych: ${available.length}.${occupied ? ` Dni z istniejącymi wpisami zostaną pominięte: ${occupied}.` : ''}`
      : 'W tym zakresie nie ma wolnych dni roboczych do dodania. Istniejące wpisy pozostaną bez zmian.';
    $('confirmLeaveCalendar').disabled = available.length === 0;
    leaveCalendarConfirmDialog.showModal();
  }

  function attendancePdfData(year, month) {
    const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
    let totalHours = 0;
    const rows = [];
    for (let day = 1; day <= 31; day += 1) {
      const available = day <= daysInMonth;
      const date = available ? new Date(year, month, day, 12) : null;
      const entry = date ? entries[localDateKey(date)] : null;
      let start = '';
      let finish = '';
      let hours = '';
      let note = '';
      if (entry && !entry.deleted && entry.kind === 'work') {
        start = validTime(entry.startTime) ? entry.startTime : '06:00';
        finish = endTime(entry.regular, 0, start);
        hours = formatNumber(entry.regular);
        totalHours += entry.regular;
      } else if (entry && !entry.deleted && entry.kind === 'vacation') {
        note = 'Urlop wypoczynkowy';
      } else if (entry && !entry.deleted && entry.kind === 'holiday') {
        note = KIND_LABELS.holiday;
      }
      rows.push({
        day, start, finish, hours, note, available,
        weekend: Boolean(date && (date.getDay() === 0 || date.getDay() === 6))
      });
    }
    return { rows, totalHours };
  }

  function drawPdfText(context, value, x, y, width, height, options = {}) {
    const lines = Array.isArray(value) ? value : [String(value ?? '')];
    const size = options.size || 22;
    context.save();
    context.fillStyle = options.color || '#111827';
    context.font = `${options.weight || 400} ${size}px Arial, sans-serif`;
    context.textAlign = options.align || 'center';
    context.textBaseline = 'middle';
    const lineHeight = size * 1.12;
    const textX = options.align === 'left' ? x + 12 : options.align === 'right' ? x + width - 12 : x + width / 2;
    const firstLineY = y + height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => context.fillText(line, textX, firstLineY + index * lineHeight, width - 20));
    context.restore();
  }

  function createJpegPdf(jpegBytes, imageWidth, imageHeight) {
    const encoder = new TextEncoder();
    const parts = [];
    const offsets = [0];
    let byteLength = 0;
    const append = (value) => {
      const bytes = typeof value === 'string' ? encoder.encode(value) : value;
      parts.push(bytes);
      byteLength += bytes.length;
    };
    const addObject = (number, body) => {
      offsets[number] = byteLength;
      append(`${number} 0 obj\n${body}\nendobj\n`);
    };
    append('%PDF-1.4\n');
    addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    addObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    offsets[4] = byteLength;
    append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    append(jpegBytes);
    append('\nendstream\nendobj\n');
    const content = 'q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
    addObject(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
    const xrefOffset = byteLength;
    append('xref\n0 6\n0000000000 65535 f \n');
    for (let number = 1; number <= 5; number += 1) append(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
    append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function createAttendancePdf(employeeName, year, month) {
    const canvas = document.createElement('canvas');
    canvas.width = 1654;
    canvas.height = 2339;
    const context = canvas.getContext('2d', { alpha: false });
    const data = attendancePdfData(year, month);
    const marginX = 70;
    const top = 54;
    const metaRowHeight = 66;
    const headerHeight = 82;
    const rowHeight = 60;
    const totalHeight = 58;
    const columns = [120, 255, 255, 190, 390, 304];
    const tableWidth = columns.reduce((sum, value) => sum + value, 0);
    const metaColumns = [180, 560, 230, tableWidth - 970];
    const fill = (x, y, width, height, color) => {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    };
    const line = (x1, y1, x2, y2) => {
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    };

    fill(0, 0, canvas.width, canvas.height, '#ffffff');
    context.fillStyle = '#111827';
    context.font = '700 40px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillText('Lista obecności', canvas.width / 2, top + 38);
    context.strokeStyle = '#111827';
    context.lineWidth = 2;

    const tableTop = top + 58;
    let y = tableTop;
    [['Rok', String(year), 'Imię i nazwisko', employeeName], ['Miesiąc', MONTHS[month], '', '']].forEach((values) => {
      let x = marginX;
      values.forEach((value, index) => {
        if (index === 0 || index === 2) fill(x, y, metaColumns[index], metaRowHeight, value ? '#dce4ee' : '#f7f9fc');
        else fill(x, y, metaColumns[index], metaRowHeight, '#f7f9fc');
        drawPdfText(context, value, x, y, metaColumns[index], metaRowHeight, {
          size: index === 0 || index === 2 ? 26 : 30,
          weight: 700,
          align: index % 2 ? 'left' : 'center'
        });
        x += metaColumns[index];
      });
      y += metaRowHeight;
    });

    fill(marginX, y, tableWidth, headerHeight, '#eef0f2');
    const headings = [['Dzień', 'm-ca'], ['Godzina', 'rozpoczęcia'], ['Godzina', 'zakończenia'], ['Liczba', 'godzin'], ['Uwagi'], ['Podpis']];
    let x = marginX;
    headings.forEach((heading, index) => {
      drawPdfText(context, heading, x, y, columns[index], headerHeight, { size: 25, weight: 700 });
      x += columns[index];
    });
    y += headerHeight;

    data.rows.forEach((row) => {
      if (row.weekend || !row.available) fill(marginX, y, tableWidth, rowHeight, row.available ? '#eef1f4' : '#f5f5f5');
      const values = [row.day, row.start, row.finish, row.hours, row.note, ''];
      let cellX = marginX;
      values.forEach((value, index) => {
        drawPdfText(context, value, cellX, y, columns[index], rowHeight, {
          size: index === 4 ? 25 : 27,
          align: index === 4 ? 'left' : 'center',
          color: row.available ? '#111827' : '#9ca3af'
        });
        cellX += columns[index];
      });
      y += rowHeight;
    });

    const firstThreeWidth = columns[0] + columns[1] + columns[2];
    fill(marginX, y, firstThreeWidth, totalHeight, '#f7f7f7');
    drawPdfText(context, 'Razem', marginX, y, firstThreeWidth, totalHeight, { size: 27, weight: 700, align: 'right' });
    drawPdfText(context, formatNumber(data.totalHours), marginX + firstThreeWidth, y, columns[3], totalHeight, { size: 27, weight: 700 });
    const bottom = y + totalHeight;

    [tableTop, tableTop + metaRowHeight, tableTop + metaRowHeight * 2].forEach((lineY) => line(marginX, lineY, marginX + tableWidth, lineY));
    let metaX = marginX;
    metaColumns.forEach((columnWidth) => { line(metaX, tableTop, metaX, tableTop + metaRowHeight * 2); metaX += columnWidth; });
    line(marginX + tableWidth, tableTop, marginX + tableWidth, tableTop + metaRowHeight * 2);
    const attendanceTop = tableTop + metaRowHeight * 2;
    line(marginX, attendanceTop, marginX + tableWidth, attendanceTop);
    line(marginX, attendanceTop + headerHeight, marginX + tableWidth, attendanceTop + headerHeight);
    for (let index = 1; index <= 31; index += 1) line(marginX, attendanceTop + headerHeight + index * rowHeight, marginX + tableWidth, attendanceTop + headerHeight + index * rowHeight);
    line(marginX, bottom, marginX + tableWidth, bottom);
    let columnX = marginX;
    columns.forEach((columnWidth, index) => {
      line(columnX, attendanceTop, columnX, index === 1 || index === 2 ? y : bottom);
      columnX += columnWidth;
    });
    line(marginX + tableWidth, attendanceTop, marginX + tableWidth, bottom);

    const jpeg = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PDF')), 'image/jpeg', .94));
    return createJpegPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
  }

  function leaveRequestDateLabel(key) {
    return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(dateFromKey(key));
  }

  function leaveRequestWorkdays(fromKey, toKey) {
    const keys = [];
    const days = settings.workdays.length ? settings.workdays : [1, 2, 3, 4, 5];
    for (let date = dateFromKey(fromKey), end = dateFromKey(toKey); date <= end; date = addDays(date, 1)) {
      if (days.includes(date.getDay())) keys.push(localDateKey(date));
    }
    return keys;
  }

  async function createLeaveRequestPdf(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1654;
    canvas.height = 2339;
    const context = canvas.getContext('2d', { alpha: false });
    const left = 120;
    const right = canvas.width - 120;
    const center = canvas.width / 2;
    const dottedLine = (x1, y, x2) => {
      context.save();
      context.strokeStyle = '#111827';
      context.lineWidth = 2;
      context.setLineDash([4, 7]);
      context.beginPath();
      context.moveTo(x1, y);
      context.lineTo(x2, y);
      context.stroke();
      context.restore();
    };
    const centeredText = (value, x, y, width, size = 30, weight = 400) => {
      context.save();
      context.fillStyle = '#111827';
      context.font = `${weight} ${size}px Arial, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.fillText(value, x + width / 2, y, width);
      context.restore();
    };

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    dottedLine(left, 205, 690);
    centeredText(data.employeeName, left, 195, 570, 31, 600);
    centeredText('(imię i nazwisko)', left, 248, 570, 25, 400);

    dottedLine(950, 205, right);
    centeredText(`${data.place}, ${leaveRequestDateLabel(data.requestDate)}`, 950, 195, right - 950, 29, 600);
    centeredText('(miejscowość, data)', 950, 248, right - 950, 25, 400);

    centeredText('Wniosek o urlop', left, 500, right - left, 46, 700);
    centeredText('Niniejszym składam wniosek o udzielenie w dniach', left, 730, right - left, 33, 400);

    context.fillStyle = '#111827';
    context.font = '400 32px Arial, sans-serif';
    context.textAlign = 'left';
    context.fillText('od', left, 855);
    dottedLine(left + 55, 864, 650);
    centeredText(leaveRequestDateLabel(data.fromKey), left + 55, 852, 475, 32, 600);
    context.fillText('do', 690, 855);
    dottedLine(740, 864, 1190);
    centeredText(leaveRequestDateLabel(data.toKey), 740, 852, 450, 32, 600);
    context.fillText('przysługującego za', 1220, 855);

    context.fillText('rok', left, 980);
    dottedLine(left + 65, 989, 300);
    centeredText(String(data.year), left + 65, 977, 115, 32, 600);
    context.fillText(`urlopu ${data.type}.`, 335, 980);

    dottedLine(left, 1450, 690);
    centeredText('(podpis kierownika)', left, 1495, 570, 25, 400);
    dottedLine(950, 1450, right);
    centeredText('(podpis pracownika)', 950, 1495, right - 950, 25, 400);

    const jpeg = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PDF')), 'image/jpeg', .96));
    return createJpegPdf(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height);
  }

  // Zwraca false, gdy użytkownik anulował udostępnianie.
  async function shareAttendancePdf(pdf, filename, title = 'Lista obecności') {
    const file = new File([pdf], filename, { type: 'application/pdf' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    const url = URL.createObjectURL(pdf);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }

  function renderSettings() {
    $('automaticEntries').checked = settings.automaticEntries;
    $('defaultStartTime').value = settings.startTime;
    $('defaultWorkHours').value = settings.regularHours;
    $('defaultEmployeeName').value = settings.employeeName;
    document.querySelector(`input[name="theme"][value="${settings.theme}"]`).checked = true;
    document.querySelectorAll('[data-workday]').forEach((input) => {
      input.checked = settings.workdays.includes(Number(input.dataset.workday));
    });
    $('automaticStatus').classList.toggle('manual', !settings.automaticEntries);
    $('automaticStatus').textContent = settings.automaticEntries && settings.workdays.length
      ? 'Automat jest włączony — w zaznaczone dni aplikacja utworzy wpis po otwarciu.'
      : settings.automaticEntries
        ? 'Automat jest włączony, ale nie wybrano żadnego dnia roboczego.'
      : 'Automat jest wyłączony — wpisy dodajesz ręcznie w zakładce Tydzień.';
  }

  function scheduledDays() {
    return settings.workdays.length ? settings.workdays : [1, 2, 3, 4, 5];
  }

  function monthNorm(year, month) {
    const days = scheduledDays();
    const last = new Date(year, month + 1, 0, 12).getDate();
    let count = 0;
    for (let day = 1; day <= last; day += 1) {
      const date = new Date(year, month, day, 12);
      if (!days.includes(date.getDay())) continue;
      const entry = entries[localDateKey(date)];
      if (entry && !entry.deleted && entry.kind !== 'work') continue;
      count += 1;
    }
    return count * settings.regularHours;
  }

  function renderStatistics() {
    const now = new Date();
    const todayKey = localDateKey(now);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthly = Array.from({ length: 12 }, () => ({ regular: 0, overtime: 0, entries: 0 }));
    let vacationDays = 0;
    let sickDays = 0;
    let workDays = 0;
    let previousTotal = 0;
    Object.values(entries).forEach((entry) => {
      if (entry.deleted) return;
      const date = dateFromKey(entry.date);
      const year = date.getFullYear();
      if (entry.kind === 'work' && year === statisticsYear - 1) previousTotal += entry.regular + entry.overtime;
      if (year !== statisticsYear) return;
      const bucket = monthly[date.getMonth()];
      bucket.entries += 1;
      if (entry.kind === 'work') {
        bucket.regular += entry.regular;
        bucket.overtime += entry.overtime;
        workDays += 1;
      } else if (entry.date <= todayKey) {
        if (entry.kind === 'vacation') vacationDays += 1;
        else if (entry.kind === 'sick' || entry.kind === 'child_sick') sickDays += 1;
      }
    });
    const overtimeTotal = monthly.reduce((sum, bucket) => sum + bucket.overtime, 0);
    const total = monthly.reduce((sum, bucket) => sum + bucket.regular + bucket.overtime, 0);
    $('statisticsYear').textContent = statisticsYear;
    $('nextYear').disabled = statisticsYear >= currentYear;
    $('yearHours').textContent = formatNumber(total);
    $('yearCompare').textContent = previousTotal ? `Rok ${statisticsYear - 1}: ${formatNumber(previousTotal)} godz.` : '';
    $('yearTiles').innerHTML = [
      ['Nadgodziny', `${formatNumber(overtimeTotal)} h`],
      ['Dni urlopu', vacationDays],
      ['Dni chorobowego', sickDays],
      ['Średnio na dzień pracy', workDays ? `${formatNumber(total / workDays)} h` : '–']
    ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('monthList').innerHTML = monthly.map((bucket, index) => {
      const hours = bucket.regular + bucket.overtime;
      const isFuture = statisticsYear > currentYear || (statisticsYear === currentYear && index > currentMonth);
      const isCurrent = statisticsYear === currentYear && index === currentMonth;
      const norm = monthNorm(statisticsYear, index);
      const scale = Math.max(norm, hours, 1);
      const width = (value) => (value ? Math.max(2, value / scale * 100) : 0);
      const marker = hours > norm && norm > 0 ? `<span class="month-norm" style="left:${norm / scale * 100}%"></span>` : '';
      let delta = '';
      let deltaClass = '';
      if (isCurrent) delta = `z ${formatNumber(norm)}`;
      else if (!isFuture && bucket.entries) {
        const difference = hours - norm;
        delta = difference === 0 ? 'norma' : `${difference > 0 ? '+' : '−'}${formatNumber(Math.abs(difference))}`;
        deltaClass = difference > 0 ? 'over' : difference < 0 ? 'under' : '';
      }
      const hoursText = isFuture && !hours ? '–' : `${formatNumber(hours)} h`;
      const spoken = `${MONTHS[index]}: ${formatNumber(hours)} godzin, w tym ${formatNumber(bucket.overtime)} nadgodzin; norma ${formatNumber(norm)} godzin. Otwórz w kalendarzu`;
      return `<button class="month-row${isFuture ? ' future' : ''}${isCurrent ? ' current' : ''}" type="button" data-stat-month="${index}" aria-label="${spoken}">
        <span class="month-name">${MONTHS[index]}</span>
        <span class="month-track" aria-hidden="true"><span class="month-bar regular" style="width:${width(bucket.regular)}%"></span><span class="month-bar overtime" style="width:${width(bucket.overtime)}%"></span>${marker}</span>
        <span class="month-hours">${hoursText}<small class="${deltaClass}">${delta}</small></span>
      </button>`;
    }).join('');
  }

  function renderVacations() {
    const todayKey = localDateKey(new Date());
    const vacations = Object.values(entries)
      .filter((entry) => !entry.deleted && entry.kind === 'vacation' && entry.date <= todayKey && dateFromKey(entry.date).getFullYear() === vacationYear)
      .sort((a, b) => b.date.localeCompare(a.date));
    $('vacationYear').textContent = vacationYear;
    $('nextVacationYear').disabled = vacationYear >= new Date().getFullYear();
    $('vacationDaysTotal').textContent = vacations.length;
    $('vacationListCount').textContent = vacations.length ? `${vacations.length} ${vacations.length === 1 ? 'dzień' : 'dni'}` : '';
    $('vacationEmpty').hidden = vacations.length > 0;
    $('vacationList').innerHTML = vacations.map((entry) => {
      const date = dateFromKey(entry.date);
      const weekday = new Intl.DateTimeFormat('pl-PL', { weekday: 'long' }).format(date);
      const fullDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
      const month = new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date);
      const note = typeof entry.note === 'string' ? entry.note.trim() : '';
      return `<button class="vacation-day" type="button" data-vacation-key="${entry.date}" aria-label="${note ? 'Edytuj' : 'Dodaj'} opis urlopu: ${fullDate}">
        <span class="vacation-date">${date.getDate()}</span>
        <span class="vacation-copy"><strong>${weekday.charAt(0).toUpperCase() + weekday.slice(1)}</strong><span>${fullDate}</span><span class="vacation-description${note ? '' : ' empty'}">${note ? escapeHTML(note) : 'Dodaj opis'}</span></span>
        <span class="vacation-month">${month}</span>
      </button>`;
    }).join('');
  }

  function openVacationNote(key) {
    const entry = entries[key];
    if (!entry || entry.kind !== 'vacation') return;
    editingVacationKey = key;
    const date = dateFromKey(key);
    const note = typeof entry.note === 'string' ? entry.note : '';
    $('vacationNoteDate').textContent = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
    $('vacationNote').value = note;
    $('vacationNoteCounter').textContent = `${note.length}/300`;
    $('removeVacationNote').disabled = !note.trim();
    vacationNoteDialog.showModal();
    requestAnimationFrame(() => $('vacationNote').focus());
  }

  function switchView(view) {
    activeView = view;
    $('weekView').hidden = view !== 'week';
    $('calendarView').hidden = view !== 'calendar';
    $('statisticsView').hidden = view !== 'statistics';
    $('vacationView').hidden = view !== 'vacation';
    $('settingsView').hidden = view !== 'settings';
    document.body.classList.toggle('week-active', view === 'week');
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (view === 'calendar') renderCalendar();
    if (view === 'statistics') renderStatistics();
    if (view === 'vacation') renderVacations();
    if (view === 'settings') renderSettings();
  }

  function openEditor(key) {
    const entry = entries[key];
    if (!entry) return;
    editingKey = key;
    draft = { kind: entry.kind, regular: entry.regular, overtime: entry.overtime, startTime: validTime(entry.startTime) ? entry.startTime : '06:00' };
    const date = dateFromKey(key);
    $('editorTitle').textContent = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
    document.querySelector(`input[name="kind"][value="${draft.kind}"]`).checked = true;
    updateEditor();
    editor.showModal();
  }

  function updateEditor() {
    $('regularOutput').textContent = `${formatNumber(draft.regular)} h`;
    $('overtimeOutput').textContent = `${formatNumber(draft.overtime)} h`;
    $('startTime').textContent = draft.startTime;
    $('endTime').textContent = endTimeLabel(draft.regular, draft.overtime, draft.startTime);
    $('timeFields').hidden = draft.kind !== 'work';
  }

  function manualEntryValues() {
    const regular = Math.max(.5, Math.min(24, Number($('manualRegularHours').value) || settings.regularHours));
    const overtime = Math.max(0, Math.min(12, Number($('manualOvertimeHours').value) || 0));
    const startTime = validTime($('manualStartTime').value) ? $('manualStartTime').value : settings.startTime;
    return { regular, overtime, startTime };
  }

  function updateManualEntrySummary() {
    const { regular, overtime, startTime } = manualEntryValues();
    const total = regular + overtime;
    $('manualEntrySummary').textContent = `${startTime}–${endTimeLabel(regular, overtime, startTime)} • razem ${formatNumber(total)} godz.${overtime ? `, w tym ${formatNumber(overtime)} nadgodz.` : ''}`;
  }

  $('previousWeek').addEventListener('click', () => { weekOffset -= 1; render(); });
  $('nextWeek').addEventListener('click', () => { weekOffset += 1; render(); });
  $('currentWeekButton').addEventListener('click', () => { weekOffset = 0; render(); });
  let manualEntryWeekStart = null;

  function weekOffsetFor(key) {
    return Math.round((startOfWeek(dateFromKey(key)) - startOfWeek(new Date())) / (7 * 24 * 60 * 60 * 1000));
  }

  // Pytanie o rodzaj wpisu dla dat przyszłych, w pozostałych przypadkach wpis powstaje od razu.
  function requestEntry(candidate) {
    if (candidate.key > localDateKey(new Date())) {
      pendingFutureEntry = candidate;
      const formattedDate = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(dateFromKey(candidate.key));
      $('futureEntryConfirmText').textContent = `Wybrana data (${formattedDate}) jest w przyszłości. Wybierz rodzaj wpisu.`;
      futureEntryConfirmDialog.showModal();
      return;
    }
    commitManualEntry(candidate);
  }

  function openManualEntry(preferredKey = '') {
    manualEntryWeekStart = preferredKey ? startOfWeek(dateFromKey(preferredKey)) : selectedWeekStart();
    const weekStart = manualEntryWeekStart;
    const weekEnd = addDays(weekStart, 6);
    let suggestedDate = preferredKey;
    if (!suggestedDate) {
      for (let cursor = weekStart; cursor <= weekEnd; cursor = addDays(cursor, 1)) {
        const key = localDateKey(cursor);
        if (!entries[key] || entries[key].deleted) { suggestedDate = key; break; }
      }
    }
    $('manualEntryDate').min = localDateKey(weekStart);
    $('manualEntryDate').max = localDateKey(weekEnd);
    $('manualEntryDate').value = suggestedDate;
    $('manualStartTime').value = settings.startTime;
    $('manualRegularHours').value = settings.regularHours;
    $('manualOvertimeHours').value = 0;
    updateManualEntrySummary();
    $('manualEntryError').textContent = suggestedDate ? '' : 'Brak wolnego dnia w wybranym tygodniu.';
    manualEntryDialog.showModal();
  }
  $('addManualEntry').addEventListener('click', () => openManualEntry());
  $('missingDaysList').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-add-day]');
    if (chip) requestEntry({ key: chip.dataset.addDay, regular: settings.regularHours, overtime: 0, startTime: settings.startTime });
  });
  $('closeManualEntry').addEventListener('click', () => manualEntryDialog.close());
  function commitManualEntry(entry, kind = 'work') {
    const isWork = kind === 'work';
    entries[entry.key] = {
      date: entry.key,
      kind,
      regular: isWork ? entry.regular : 0,
      overtime: isWork ? entry.overtime : 0,
      startTime: entry.startTime,
      deleted: false
    };
    highlightedEntryKey = entry.key;
    saveEntries();
    weekOffset = weekOffsetFor(entry.key);
    pendingFutureEntry = null;
    if (futureEntryConfirmDialog.open) futureEntryConfirmDialog.close();
    manualEntryDialog.close();
    render();
  }

  $('manualEntryForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const key = $('manualEntryDate').value;
    const weekStart = manualEntryWeekStart || selectedWeekStart();
    const firstDayKey = localDateKey(weekStart);
    const lastDayKey = localDateKey(addDays(weekStart, 6));
    if (!isValidDateKey(key) || key < firstDayKey || key > lastDayKey) {
      $('manualEntryError').textContent = 'Wybierz poprawną datę z wybranego tygodnia.';
      return;
    }
    if (entries[key] && !entries[key].deleted) {
      $('manualEntryError').textContent = 'Dla wybranego dnia istnieje już wpis.';
      return;
    }
    const { regular, overtime, startTime } = manualEntryValues();
    requestEntry({ key, regular, overtime, startTime });
  });
  $('cancelFutureEntry').addEventListener('click', () => {
    pendingFutureEntry = null;
    futureEntryConfirmDialog.close();
  });
  $('confirmFutureWorkEntry').addEventListener('click', () => {
    if (pendingFutureEntry) commitManualEntry(pendingFutureEntry, 'work');
  });
  $('confirmFutureVacationEntry').addEventListener('click', () => {
    if (pendingFutureEntry) commitManualEntry(pendingFutureEntry, 'vacation');
  });
  ['manualStartTime', 'manualRegularHours', 'manualOvertimeHours'].forEach((id) => {
    $(id).addEventListener('input', updateManualEntrySummary);
  });
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('previousMonth').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1, 12);
    renderCalendar();
  });
  $('nextMonth').addEventListener('click', () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1, 12);
    renderCalendar();
  });
  $('currentMonthButton').addEventListener('click', () => {
    const today = new Date();
    calendarDate = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    renderCalendar();
  });
  $('calendarGrid').addEventListener('click', (event) => {
    const day = event.target.closest('[data-calendar-key]');
    if (day) { openEditor(day.dataset.calendarKey); return; }
    const empty = event.target.closest('[data-calendar-add]');
    if (empty) openManualEntry(empty.dataset.calendarAdd);
  });
  $('monthList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-stat-month]');
    if (!row) return;
    calendarDate = new Date(statisticsYear, Number(row.dataset.statMonth), 1, 12);
    switchView('calendar');
  });
  $('openLeaveRequestGenerator').addEventListener('click', openLeaveRequestGenerator);
  $('closeLeaveRequestDialog').addEventListener('click', () => leaveRequestDialog.close());
  $('leaveRequestPlace').addEventListener('change', (event) => {
    const place = event.target.value.trim().slice(0, 80);
    event.target.value = place;
    if (settings.leaveRequestPlace !== place) {
      settings.leaveRequestPlace = place;
      saveSettings();
    }
  });
  $('leaveRequestFrom').addEventListener('change', (event) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) {
      $('leaveRequestYear').value = dateFromKey(event.target.value).getFullYear();
      if (!$('leaveRequestTo').value || $('leaveRequestTo').value < event.target.value) $('leaveRequestTo').value = event.target.value;
    }
  });
  $('leaveRequestForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const employeeName = settings.employeeName.trim();
    const place = $('leaveRequestPlace').value.trim();
    const requestDate = $('leaveRequestDate').value;
    const fromKey = $('leaveRequestFrom').value;
    const toKey = $('leaveRequestTo').value;
    const year = Number($('leaveRequestYear').value);
    const type = $('leaveRequestType').value;
    if (!employeeName) {
      $('leaveRequestError').textContent = 'Uzupełnij imię i nazwisko w Ustawieniach.';
      return;
    }
    if (!place) {
      $('leaveRequestError').textContent = 'Wpisz miejscowość.';
      $('leaveRequestPlace').focus();
      return;
    }
    if (![requestDate, fromKey, toKey].every(isValidDateKey) || fromKey > toKey) {
      $('leaveRequestError').textContent = 'Wybierz poprawny zakres dat urlopu.';
      return;
    }
    const rangeDays = Math.round((dateFromKey(toKey) - dateFromKey(fromKey)) / 86400000) + 1;
    if (rangeDays > 366) {
      $('leaveRequestError').textContent = 'Zakres urlopu może obejmować maksymalnie 366 dni.';
      return;
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      $('leaveRequestError').textContent = 'Podaj poprawny rok (2000–2100), za który przysługuje urlop.';
      return;
    }
    if (settings.leaveRequestPlace !== place) {
      settings.leaveRequestPlace = place;
      saveSettings();
    }
    $('leaveRequestError').textContent = '';
    const submitButton = event.submitter || $('leaveRequestForm').querySelector('button[type="submit"]');
    const previousLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Tworzenie PDF…';
    try {
      const pdf = await createLeaveRequestPdf({ employeeName, place, requestDate, fromKey, toKey, year, type });
      const firstName = employeeName.split(/\s+/)[0] || 'pracownik';
      const safeFirstName = firstName.replace(/[\\/:*?"<>|]/g, '').replace(/\.+$/g, '') || 'pracownik';
      leaveRequestDialog.close();
      const delivered = await shareAttendancePdf(pdf, `wniosek-urlopowy-${safeFirstName}-${fromKey}-${toKey}.pdf`, 'Wniosek o urlop');
      if (delivered) prepareLeaveCalendarConfirmation(fromKey, toKey);
    } catch {
      $('leaveRequestError').textContent = 'Nie udało się utworzyć wniosku PDF. Spróbuj ponownie.';
      if (!leaveRequestDialog.open) leaveRequestDialog.showModal();
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = previousLabel;
    }
  });
  $('skipLeaveCalendar').addEventListener('click', () => {
    pendingLeaveCalendarRange = null;
    leaveCalendarConfirmDialog.close();
  });
  $('confirmLeaveCalendar').addEventListener('click', () => {
    if (!pendingLeaveCalendarRange?.available.length) return;
    pendingLeaveCalendarRange.available.forEach((key) => {
      entries[key] = { date: key, kind: 'vacation', regular: 0, overtime: 0, startTime: settings.startTime, deleted: false };
    });
    const firstKey = pendingLeaveCalendarRange.fromKey;
    saveEntries();
    calendarDate = new Date(dateFromKey(firstKey).getFullYear(), dateFromKey(firstKey).getMonth(), 1, 12);
    pendingLeaveCalendarRange = null;
    leaveCalendarConfirmDialog.close();
    switchView('calendar');
  });
  $('pdfMonthSelect').addEventListener('input', () => $('pdfMonthSelect').setCustomValidity(''));
  $('openPdfGenerator').addEventListener('click', openPdfGenerator);
  $('closePdfDialog').addEventListener('click', () => pdfDialog.close());
  $('pdfForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const monthMatch = /^(\d{4})-(\d{2})$/.exec($('pdfMonthSelect').value);
    if (!monthMatch || Number(monthMatch[2]) < 1 || Number(monthMatch[2]) > 12) {
      $('pdfMonthSelect').setCustomValidity('Wybierz miesiąc w formacie RRRR-MM.');
      $('pdfMonthSelect').reportValidity();
      return;
    }
    const exportYear = Number(monthMatch[1]);
    const exportMonth = Number(monthMatch[2]) - 1;
    pdfDialog.close();
    const submitButton = event.submitter || $('pdfForm').querySelector('button[type="submit"]');
    const previousLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = 'Tworzenie PDF…';
    try {
      const pdf = await createAttendancePdf(settings.employeeName, exportYear, exportMonth);
      const monthNumber = String(exportMonth + 1).padStart(2, '0');
      const firstName = settings.employeeName.trim().split(/\s+/)[0] || 'pracownik';
      const safeFirstName = firstName.replace(/[\\/:*?"<>|]/g, '').replace(/\.+$/g, '') || 'pracownik';
      await shareAttendancePdf(pdf, `lista-obecnosci-${safeFirstName}-${exportYear}-${monthNumber}.pdf`);
    } catch {
      alert('Nie udało się utworzyć pliku PDF. Spróbuj ponownie.');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = previousLabel;
    }
  });
  $('previousYear').addEventListener('click', () => { statisticsYear -= 1; renderStatistics(); });
  $('nextYear').addEventListener('click', () => {
    if (statisticsYear < new Date().getFullYear()) { statisticsYear += 1; renderStatistics(); }
  });
  $('previousVacationYear').addEventListener('click', () => { vacationYear -= 1; renderVacations(); });
  $('nextVacationYear').addEventListener('click', () => {
    if (vacationYear < new Date().getFullYear()) { vacationYear += 1; renderVacations(); }
  });
  $('automaticEntries').addEventListener('change', (event) => {
    settings.automaticEntries = event.target.checked;
    if (settings.automaticEntries && !confirmBulkAutofill()) settings.automaticEntries = false;
    saveSettings();
    if (settings.automaticEntries) generateMissingWorkdays();
    render();
  });
  $('defaultStartTime').addEventListener('change', (event) => {
    settings.startTime = validTime(event.target.value) ? event.target.value : '06:00';
    saveSettings();
    renderSettings();
  });
  $('defaultWorkHours').addEventListener('change', (event) => {
    settings.regularHours = roundToHalf(Math.max(.5, Math.min(24, Number(event.target.value) || 8)));
    saveSettings();
    renderSettings();
  });
  $('defaultEmployeeName').addEventListener('change', (event) => {
    settings.employeeName = event.target.value.trim().slice(0, 100);
    event.target.value = settings.employeeName;
    saveSettings();
  });
  document.querySelectorAll('[data-workday]').forEach((input) => input.addEventListener('change', () => {
    const previousWorkdays = settings.workdays;
    settings.workdays = Array.from(document.querySelectorAll('[data-workday]:checked'))
      .map((item) => Number(item.dataset.workday));
    if (!confirmBulkAutofill()) settings.workdays = previousWorkdays;
    saveSettings();
    generateMissingWorkdays();
    render();
  }));
  document.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener('change', (event) => {
    settings.theme = event.target.value;
    saveSettings(false);
    renderSettings();
  }));
  $('vacationList').addEventListener('click', (event) => {
    const item = event.target.closest('[data-vacation-key]');
    if (item) openVacationNote(item.dataset.vacationKey);
  });
  $('closeVacationNote').addEventListener('click', () => vacationNoteDialog.close());
  $('vacationNote').addEventListener('input', (event) => {
    $('vacationNoteCounter').textContent = `${event.target.value.length}/300`;
  });
  $('vacationNoteForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editingVacationKey || !entries[editingVacationKey]) return;
    entries[editingVacationKey].note = $('vacationNote').value.trim();
    saveEntries();
    vacationNoteDialog.close();
    renderVacations();
  });
  $('removeVacationNote').addEventListener('click', () => {
    if (!editingVacationKey || !entries[editingVacationKey]) return;
    delete entries[editingVacationKey].note;
    saveEntries();
    vacationNoteDialog.close();
    renderVacations();
  });
  $('recordList').addEventListener('click', (event) => {
    const record = event.target.closest('[data-key]');
    if (record) {
      if (record.dataset.key === highlightedEntryKey) {
        highlightedEntryKey = null;
        record.classList.remove('new-entry');
        record.querySelector('.new-entry-badge')?.remove();
      }
      openEditor(record.dataset.key);
    }
  });
  $('cancelEditor').addEventListener('click', () => editor.close());

  document.querySelectorAll('input[name="kind"]').forEach((input) => input.addEventListener('change', (event) => {
    draft.kind = event.target.value;
    if (draft.kind !== 'work') { draft.regular = 0; draft.overtime = 0; }
    else if (draft.regular === 0) draft.regular = settings.regularHours;
    updateEditor();
  }));

  document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => {
    const field = button.dataset.step;
    const direction = Number(button.dataset.direction);
    const max = field === 'regular' ? 24 : 12;
    const min = field === 'regular' && draft.kind === 'work' ? .5 : 0;
    draft[field] = Math.min(max, Math.max(min, draft[field] + direction * .5));
    updateEditor();
  }));

  $('editorForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editingKey || !entries[editingKey]) return;
    if (draft.kind === 'work' && draft.regular < .5) draft.regular = .5;
    entries[editingKey] = { ...entries[editingKey], ...draft };
    saveEntries();
    editor.close();
    render();
  });

  $('deleteEntry').addEventListener('click', () => confirmDialog.showModal());
  $('keepEntry').addEventListener('click', () => confirmDialog.close());
  $('confirmDelete').addEventListener('click', () => {
    if (editingKey && entries[editingKey]) {
      entries[editingKey].deleted = true;
      saveEntries();
    }
    confirmDialog.close();
    editor.close();
    render();
  });

  $('openArchive').addEventListener('click', () => { updateArchiveIndicator(); refreshUndoImport(); archiveDialog.showModal(); });
  $('closeArchive').addEventListener('click', () => archiveDialog.close());
  $('exportArchive').addEventListener('click', async () => {
    const payload = {
      format: 'dniowki-archive',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      entries: Object.values(entries).sort((a, b) => a.date.localeCompare(b.date))
    };
    const contents = JSON.stringify(payload, null, 2);
    const file = new File([contents], ARCHIVE_FILENAME, { type: 'application/json' });
    let directlySaved = false;
    try {
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({
          id: 'dniowki-archive',
          suggestedName: ARCHIVE_FILENAME,
          types: [{ description: 'Archiwum Dniówki', accept: { 'application/json': ['.json'] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(contents);
        await writable.close();
        directlySaved = true;
      } else if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Archiwum Dniówki' });
      } else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = ARCHIVE_FILENAME;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      $('archiveStatus').className = 'archive-status error';
      $('archiveStatus').textContent = 'Nie udało się zapisać archiwum. Spróbuj ponownie.';
      return;
    }
    writeArchiveState(true, new Date().toISOString());
    updateArchiveIndicator();
    $('archiveStatus').classList.add('success');
    $('archiveStatus').textContent = directlySaved
      ? `Zapisano ${ARCHIVE_FILENAME}. Ponowny zapis pod tą nazwą zastąpi poprzednią kopię.`
      : `Archiwum ma stałą nazwę ${ARCHIVE_FILENAME}. W „Plikach” wybierz poprzedni plik i potwierdź „Zastąp”.`;
  });

  let pendingImport = null;

  function parseArchive(text) {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || payload.format !== 'dniowki-archive' || payload.version !== 1
      || !Array.isArray(payload.entries) || payload.entries.length > MAX_ENTRIES) throw new Error('invalid');
    const restored = {};
    for (const raw of payload.entries) {
      const entry = sanitizeEntry(raw);
      if (!entry || restored[entry.date]) throw new Error('invalid');
      restored[entry.date] = entry;
    }
    const exportedAt = typeof payload.exportedAt === 'string' && !Number.isNaN(Date.parse(payload.exportedAt)) ? payload.exportedAt : null;
    const importedSettings = payload.settings && typeof payload.settings === 'object' ? normalizeSettings(payload.settings) : null;
    return { restored, exportedAt, importedSettings };
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function readPreImportSnapshot() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(PRE_IMPORT_KEY) || 'null');
      if (!snapshot || typeof snapshot !== 'object' || Number.isNaN(Date.parse(snapshot.createdAt))) return null;
      return {
        createdAt: snapshot.createdAt,
        entries: sanitizeEntryMap(snapshot.entries),
        settings: normalizeSettings(snapshot.settings),
        archiveState: snapshot.archiveState && typeof snapshot.archiveState === 'object' ? snapshot.archiveState : null
      };
    } catch { return null; }
  }

  function refreshUndoImport() {
    const snapshot = readPreImportSnapshot();
    $('undoImport').hidden = !snapshot;
    if (snapshot) $('undoImportInfo').textContent = `Przywróć dane sprzed importu z ${formatDateTime(snapshot.createdAt)}`;
  }

  function liveEntryCount(map) {
    return Object.values(map).filter((entry) => !entry.deleted).length;
  }

  $('importArchive').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseArchive(await file.text());
      pendingImport = { ...parsed, name: file.name };
      const liveKeys = Object.values(parsed.restored).filter((entry) => !entry.deleted).map((entry) => entry.date).sort();
      const range = liveKeys.length ? ` (od ${leaveRequestDateLabel(liveKeys[0])} do ${leaveRequestDateLabel(liveKeys[liveKeys.length - 1])})` : '';
      const saved = parsed.exportedAt ? `, zapisany ${formatDateTime(parsed.exportedAt)}` : '';
      $('importConfirmText').textContent = `Plik ${file.name} zawiera ${liveKeys.length} wpisów${range}${saved}. Bieżące dane (${liveEntryCount(entries)} wpisów) zostaną zastąpione.${(parsed.importedSettings || settings).automaticEntries ? ' Przy włączonym automacie dni robocze od ostatniego wpisu do dziś zostaną uzupełnione.' : ''} Poprzedni stan będzie można przywrócić przyciskiem „Cofnij ostatni import”.`;
      importConfirmDialog.showModal();
    } catch {
      pendingImport = null;
      $('archiveStatus').className = 'archive-status error';
      $('archiveStatus').textContent = 'Nie udało się wczytać pliku. Wybierz poprawne archiwum aplikacji Dniówki. Dotychczasowe dane nie zostały zmienione.';
    } finally { event.target.value = ''; }
  });

  $('cancelImport').addEventListener('click', () => {
    pendingImport = null;
    importConfirmDialog.close();
  });

  $('confirmImport').addEventListener('click', () => {
    importConfirmDialog.close();
    if (!pendingImport) return;
    const { restored, exportedAt, importedSettings, name } = pendingImport;
    pendingImport = null;
    const snapshot = { createdAt: new Date().toISOString(), entries, settings, archiveState: archiveState() };
    if (!writeStorage(PRE_IMPORT_KEY, JSON.stringify(snapshot))) return;
    const previousEntries = entries;
    const previousSettings = settings;
    entries = restored;
    if (importedSettings) settings = importedSettings;
    if ((importedSettings && !saveSettings(false)) || !saveEntries(false)) {
      entries = previousEntries;
      settings = previousSettings;
      saveSettings(false);
      saveEntries(false);
      $('archiveStatus').className = 'archive-status error';
      $('archiveStatus').textContent = 'Nie udało się zapisać wczytanych danych. Dotychczasowe dane zostały zachowane.';
      return;
    }
    writeArchiveState(true, exportedAt || new Date().toISOString());
    const supplemented = generateMissingWorkdays();
    render();
    updateArchiveIndicator();
    refreshUndoImport();
    if (!supplemented) $('archiveStatus').classList.add('success');
    $('archiveStatus').textContent = supplemented
      ? `Wczytano ${name} i dodano brakujące dni. Zapisz nowe archiwum.`
      : `Wczytano archiwum: ${name}`;
  });

  $('undoImport').addEventListener('click', () => {
    const snapshot = readPreImportSnapshot();
    if (!snapshot) { refreshUndoImport(); return; }
    if (!window.confirm('Przywrócić dane sprzed ostatniego importu? Zmiany wprowadzone po imporcie zostaną utracone.')) return;
    entries = snapshot.entries;
    settings = snapshot.settings;
    saveSettings(false);
    saveEntries(false);
    const previous = snapshot.archiveState;
    const validDate = previous && typeof previous.date === 'string' && !Number.isNaN(Date.parse(previous.date));
    writeArchiveState(Boolean(previous?.saved) && validDate, validDate ? previous.date : null);
    try { localStorage.removeItem(PRE_IMPORT_KEY); } catch { /* migawka zostanie nadpisana przy następnym imporcie */ }
    render();
    updateArchiveIndicator();
    refreshUndoImport();
    $('archiveStatus').className = 'archive-status success';
    $('archiveStatus').textContent = 'Przywrócono dane sprzed importu.';
  });

  function registerAppUpdates() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    const prompt = $('updatePrompt');
    const applyButton = $('applyUpdate');
    const dismissButton = $('dismissUpdate');
    let waitingWorker = null;
    let dismissed = false;
    let refreshing = false;
    let controlled = Boolean(navigator.serviceWorker.controller);

    const offerUpdate = (worker) => {
      waitingWorker = worker;
      if (!dismissed) prompt.hidden = false;
    };

    dismissButton.addEventListener('click', () => {
      dismissed = true;
      prompt.hidden = true;
    });

    applyButton.addEventListener('click', () => {
      if (!waitingWorker) return;
      applyButton.disabled = true;
      applyButton.textContent = 'Aktualizuję…';
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Pierwsza instalacja workera przejmuje stronę bez wcześniejszego kontrolera — bez przeładowania.
      if (!controlled) { controlled = true; return; }
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('./service-worker.js').then((registration) => {
      if (registration.waiting) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      const checkForUpdate = () => registration.update().catch(() => {});
      window.setTimeout(checkForUpdate, 1500);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
    }).catch(() => {});
  }

  applyTheme();
  const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  const updateSystemTheme = () => { if (settings.theme === 'system') applyTheme(); };
  if (colorScheme?.addEventListener) colorScheme.addEventListener('change', updateSystemTheme);
  else colorScheme?.addListener?.(updateSystemTheme);
  const safely = (action) => { try { action(); } catch (error) { console.error(error); } };
  safely(generateMissingWorkdays);
  safely(updateArchiveIndicator);
  safely(render);
  $('appVersion').textContent = `Dniówki, wersja ${APP_VERSION} (${APP_BUILD}). Aktualizacje pobierają się w tle; przeładowanie następuje po wybraniu „Zaktualizuj”.`;
  registerAppUpdates();
  navigator.storage?.persist?.().catch(() => {});

  window.addEventListener('storage', (event) => {
    if (event.key !== null && ![STORAGE_KEY, SETTINGS_KEY, ARCHIVE_STATE_KEY].includes(event.key)) return;
    entries = loadEntries();
    settings = loadSettings();
    safely(applyTheme);
    safely(updateArchiveIndicator);
    safely(render);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { generateMissingWorkdays(); render(); }
  });
})();
