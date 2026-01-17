/* calendar.js - Calendar + Event CRUD + Attachments + Reminders */

import { $, toast, ymd, parseYMD, weekdayItalian, formatItalianDate } from "./dom.js";
import { state, saveState, loadEvents, saveEvents } from "./state.js";
import { openConfirm } from "./modals.js";

let g_events = loadEvents();

/* ---------------------------
   Helpers time/date
---------------------------- */
function pad2(n) { return String(n).padStart(2, "0"); }

function timeToMinutes(hhmm) {
	if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
	const [hh, mm] = hhmm.split(":").map(x => parseInt(x, 10));
	if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
	return hh * 60 + mm;
}

function minutesToTime(min) {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

function dateTimeFromYmdAndTime(dayYmd, hhmm) {
	const d = parseYMD(dayYmd);
	const [hh, mm] = hhmm.split(":").map(x => parseInt(x, 10));
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh || 0, mm || 0, 0, 0);
}

function clampEndTimeIfNeeded(start, end) {
	const s = timeToMinutes(start);
	const e = timeToMinutes(end);
	if (s == null || e == null) return end;

	if (e <= s) return minutesToTime(Math.min(s + 30, 23 * 60 + 59));
	return end;
}

function normalizeLegacyEvent(ev) {
	const out = { ...ev };

	if (typeof out.allDay !== "boolean") out.allDay = false;

	if (!out.startTime && out.time) out.startTime = out.time;

	if (!out.endTime) {
		if (out.startTime && out.duration) {
			const s = timeToMinutes(out.startTime);
			const dur = parseInt(out.duration, 10);
			if (s != null && !Number.isNaN(dur)) {
				out.endTime = minutesToTime(Math.min(s + dur, 23 * 60 + 59));
			}
		}
	}

	if (!out.startTime) out.startTime = "12:00";
	if (!out.endTime) out.endTime = clampEndTimeIfNeeded(out.startTime, "12:30");

	if (!Array.isArray(out.reminders)) out.reminders = [];
	if (!Array.isArray(out.attachments)) out.attachments = [];

	if (!out.id) out.id = `ev_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
	if (!out.title) out.title = "Senza titolo";
	if (!out.date) out.date = out.day || out.date || ymd(new Date());

	if (!Array.isArray(out.reminderAck)) out.reminderAck = [];

	return out;
}

/* ---------------------------
   Events access
---------------------------- */
function getEventsForDay(dayYmd) {
	const list = (g_events[dayYmd] || []).map(normalizeLegacyEvent);

	return [...list].sort((a, b) => {
		if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
		const am = timeToMinutes(a.startTime) ?? 9999;
		const bm = timeToMinutes(b.startTime) ?? 9999;
		return am - bm;
	});
}

function countEventsForDay(dayYmd) {
	return (g_events[dayYmd]?.length || 0);
}

/* ---------------------------
   Public API (cursor/selected)
---------------------------- */
export function setCalendarCursorTo(dateObj) {
	state.calCursor = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1, 0, 0, 0, 0);
	saveState();
}

export function setSelectedDay(dateObj) {
	state.selectedDay = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);
	saveState();
	renderCalendar();
	renderDayPanel();
}

/* ---------------------------
   Render calendar grid
---------------------------- */
export function renderCalendar() {
	const cur = new Date(state.calCursor);
	const year = cur.getFullYear();
	const month = cur.getMonth();

	const months = [
		"Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
		"Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"
	];
	$("calMonthTitle").textContent = `${months[month]} ${year}`;

	const calDays = $("calDays");
	calDays.innerHTML = "";

	const first = new Date(year, month, 1);
	const firstDow = (first.getDay() + 6) % 7; // Monday=0
	const start = new Date(year, month, 1 - firstDow);

	const sel = new Date(state.selectedDay);
	const selYmd = ymd(sel);

	for (let i = 0; i < 42; i++) {
		const d = new Date(start);
		d.setDate(start.getDate() + i);

		const cell = document.createElement("div");
		cell.className = "day-cell";

		const inMonth = (d.getMonth() === month);
		if (!inMonth) cell.classList.add("muted");

		const isToday = (ymd(d) === ymd(new Date()));
		if (isToday) cell.classList.add("today");

		const isSelected = (ymd(d) === selYmd);
		if (isSelected) cell.classList.add("selected");

		const cnt = countEventsForDay(ymd(d));

		cell.innerHTML = `
			<div class="day-num">${d.getDate()}</div>
			${cnt > 0 ? `<div class="day-badge" title="${cnt} eventi">${cnt}</div>` : `<div style="width:22px;height:22px;"></div>`}
		`;

		cell.addEventListener("click", () => setSelectedDay(d));
		calDays.appendChild(cell);
	}
}

/* ---------------------------
   Render right panel day list
---------------------------- */
function renderEventTimeLabel(ev) {
	if (ev.allDay) return "Tutto il giorno";
	const s = ev.startTime || "—";
	const e = ev.endTime || "—";
	return `${s} – ${e}`;
}

function setDayEmptyUI(hasEvents) {
	const empty = $("eventsEmpty");
	const wrap = $("eventsList");

	// se mancano elementi DOM, non esplodere
	if (!empty || !wrap) return;

	empty.hidden = !!hasEvents;
	wrap.hidden = !hasEvents;

	if (!hasEvents) wrap.innerHTML = "";
}

export function renderDayPanel() {
	// ricarica sempre: così evitiamo mismatch tra storage e UI
	g_events = loadEvents();

	const d = new Date(state.selectedDay);
	const dayYmd = ymd(d);
	const list = getEventsForDay(dayYmd);

	$("dayTitle").textContent = `${weekdayItalian(d)} ${formatItalianDate(d)}`;
	$("dayMeta").textContent = `Eventi: ${list.length}`;

	// ✅ FIX definitivo: empty state SOLO se list.length === 0
	setDayEmptyUI(list.length > 0);

	const wrap = $("eventsList");
	if (!wrap) return;

	if (list.length === 0) return;

	wrap.innerHTML = "";

	list.forEach(evRaw => {
		const ev = normalizeLegacyEvent(evRaw);

		const row = document.createElement("div");
		row.className = "event-item";

		const timeLabel = renderEventTimeLabel(ev);
		const attCount = (ev.attachments?.length || 0);
		const remCount = (ev.reminders?.length || 0);

		row.innerHTML = `
			<div class="event-left">
				<div class="event-time">${timeLabel}</div>
				<div class="event-title">${(ev.title || "Senza titolo")}</div>
				${ev.notes ? `<div class="event-notes">${ev.notes}</div>` : ``}
				<div class="event-meta">
					${attCount > 0 ? `<span class="meta-pill"><i class="fa-solid fa-paperclip"></i> ${attCount}</span>` : ``}
					${remCount > 0 ? `<span class="meta-pill"><i class="fa-regular fa-bell"></i> ${remCount}</span>` : ``}
				</div>
			</div>
			<div class="event-right">
				<i class="fa-solid fa-pen-to-square"></i>
			</div>
		`;

		row.addEventListener("click", () => openEventModal("edit", ev.id));
		wrap.appendChild(row);
	});
}

/* ---------------------------
   Event modal open/close
---------------------------- */
function setAllDayUI(isAllDay) {
	const rowTimes = $("evTimesRow");
	if (!rowTimes) return;

	if (isAllDay) {
		rowTimes.classList.add("disabled");
		if ($("evStart")) $("evStart").disabled = true;
		if ($("evEnd")) $("evEnd").disabled = true;
	} else {
		rowTimes.classList.remove("disabled");
		if ($("evStart")) $("evStart").disabled = false;
		if ($("evEnd")) $("evEnd").disabled = false;
	}
}

function resetAttachmentsUI() {
	if ($("evFiles")) $("evFiles").value = "";
	if ($("evAttachList")) $("evAttachList").innerHTML = "";
}

function renderAttachmentsUI(attachments) {
	const list = $("evAttachList");
	if (!list) return;

	list.innerHTML = "";

	const items = attachments || [];
	if (items.length === 0) {
		list.innerHTML = `<div class="att-empty">Nessun allegato.</div>`;
		return;
	}

	items.forEach(att => {
		const item = document.createElement("div");
		item.className = "att-item";

		const isImg = att.type === "image/png" || att.type === "image/jpeg";
		const isPdf = att.type === "application/pdf";

		item.innerHTML = `
			<div class="att-left">
				<div class="att-ico">
					<i class="fa-solid ${isPdf ? "fa-file-pdf" : (isImg ? "fa-image" : "fa-file")}"></i>
				</div>
				<div class="att-info">
					<div class="att-name" title="${att.name}">${att.name}</div>
					<div class="att-sub">${att.type || "file"}</div>
				</div>
			</div>
			<div class="att-actions">
				<button class="btn tiny" type="button" data-act="view" data-id="${att.id}">
					<i class="fa-regular fa-eye"></i>
				</button>
				<button class="btn tiny danger" type="button" data-act="del" data-id="${att.id}">
					<i class="fa-solid fa-trash"></i>
				</button>
			</div>
		`;

		list.appendChild(item);

		// Thumbnail sotto: sempre contenuta
		if (isImg && att.dataUrl) {
			const prev = document.createElement("div");
			prev.className = "att-preview";
			prev.innerHTML = `<img src="${att.dataUrl}" alt="${att.name}" />`;
			list.appendChild(prev);
		}

		// PDF: preview leggera, senza iframe pesante dentro al modal
		if (isPdf && att.dataUrl) {
			const prev = document.createElement("div");
			prev.className = "att-preview pdf";
			prev.innerHTML = `
				<div class="att-pdfhint">
					<i class="fa-solid fa-file-pdf"></i>
					<span>PDF pronto per la visualizzazione</span>
				</div>
			`;
			list.appendChild(prev);
		}
	});
}

function getEventById(eventId) {
	for (const day of Object.keys(g_events)) {
		const arr = g_events[day] || [];
		const found = arr.find(x => x.id === eventId);
		if (found) return normalizeLegacyEvent(found);
	}
	return null;
}

function removeEventById(eventId) {
	Object.keys(g_events).forEach(day => {
		g_events[day] = (g_events[day] || []).filter(x => x.id !== eventId);
		if (g_events[day].length === 0) delete g_events[day];
	});
}

function ensureDayList(dayYmd) {
	if (!g_events[dayYmd]) g_events[dayYmd] = [];
}

function collectRemindersFromUI() {
	const v1 = $("evRem1")?.value;
	const v2 = $("evRem2")?.value;
	const v3 = $("evRem3")?.value;

	const vals = [v1, v2, v3].filter(v => v && v !== "none");

	const uniq = [];
	vals.forEach(v => { if (!uniq.includes(v)) uniq.push(v); });

	return uniq.slice(0, 3);
}

function applyRemindersToUI(reminders) {
	const r = Array.isArray(reminders) ? reminders : [];
	if ($("evRem1")) $("evRem1").value = r[0] || "none";
	if ($("evRem2")) $("evRem2").value = r[1] || "none";
	if ($("evRem3")) $("evRem3").value = r[2] || "none";
}

export function openEventModal(mode, eventId) {
	const d = new Date(state.selectedDay);
	const dayYmd = ymd(d);

	state.editEventId = null;

	resetAttachmentsUI();

	if (mode === "new") {
		$("eventModalTitle").textContent = "Nuovo evento";
		$("evTitle").value = "";
		$("evNotes").value = "";
		$("evDate").value = dayYmd;

		$("evAllDay").checked = false;
		$("evStart").value = "12:00";
		$("evEnd").value = "12:30";
		setAllDayUI(false);

		applyRemindersToUI([]);

		renderAttachmentsUI([]);

		$("btnDeleteEvent").hidden = true;
	} else {
		g_events = loadEvents();
		const ev = getEventById(eventId);
		if (!ev) { toast("Evento non trovato"); return; }

		state.editEventId = ev.id;

		$("eventModalTitle").textContent = "Modifica evento";
		$("evTitle").value = ev.title || "";
		$("evNotes").value = ev.notes || "";
		$("evDate").value = ev.date || dayYmd;

		$("evAllDay").checked = !!ev.allDay;
		$("evStart").value = ev.startTime || "12:00";
		$("evEnd").value = ev.endTime || "12:30";
		setAllDayUI(!!ev.allDay);

		applyRemindersToUI(ev.reminders || []);

		renderAttachmentsUI(ev.attachments || []);

		$("btnDeleteEvent").hidden = false;
	}

	saveState();
	const el = document.getElementById("eventModal");
	el.classList.add("show");
	el.setAttribute("aria-hidden", "false");
}

export function closeEventModal() {
	const el = document.getElementById("eventModal");
	el.classList.remove("show");
	el.setAttribute("aria-hidden", "true");
}

/* ---------------------------
   Attachments handling (in modal)
---------------------------- */
function readFileAsDataUrl(file) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onerror = () => reject(new Error("read error"));
		r.onload = () => resolve(String(r.result || ""));
		r.readAsDataURL(file);
	});
}

async function onFilesSelected(fileList) {
	if (!fileList || fileList.length === 0) return;

	const allowed = ["application/pdf", "image/png", "image/jpeg"];
	const maxFiles = 8;

	const ev = state.editEventId ? getEventById(state.editEventId) : null;
	const current = (ev?.attachments || []);

	const toRead = [];
	for (const f of Array.from(fileList).slice(0, maxFiles)) {
		if (!allowed.includes(f.type)) {
			toast("Formato non supportato: usa PDF/PNG/JPG");
			continue;
		}
		toRead.push(f);
	}

	if (toRead.length === 0) return;

	const added = [];
	for (const f of toRead) {
		const dataUrl = await readFileAsDataUrl(f);
		added.push({
			id: `att_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
			name: f.name,
			type: f.type,
			dataUrl
		});
	}

	state.tmpAttachments = [...(state.tmpAttachments || []), ...added];
	saveState();

	const merged = [...current, ...(state.tmpAttachments || [])];
	renderAttachmentsUI(merged);
	toast("Allegati aggiunti");
}

function onAttachmentActionClick(e) {
	const btn = e.target.closest("button");
	if (!btn) return;

	const act = btn.dataset.act;
	const attId = btn.dataset.id;
	if (!act || !attId) return;

	const ev = state.editEventId ? getEventById(state.editEventId) : null;
	const list = [...(ev?.attachments || []), ...(state.tmpAttachments || [])];

	const att = list.find(x => x.id === attId);
	if (!att) { toast("Allegato non trovato"); return; }

	if (act === "view") {
		// ✅ Non aprire tab vuota: usa viewer interno (se presente) altrimenti fallback window.open
		const viewer = document.getElementById("attViewer");
		const viewerFrame = document.getElementById("attViewerFrame");
		const viewerImg = document.getElementById("attViewerImg");
		const viewerTitle = document.getElementById("attViewerTitle");

		if (viewer && (viewerFrame || viewerImg) && viewerTitle) {
			viewerTitle.textContent = att.name || "Allegato";

			const isPdf = att.type === "application/pdf";
			const isImg = att.type === "image/png" || att.type === "image/jpeg";

			if (viewerFrame) viewerFrame.style.display = isPdf ? "block" : "none";
			if (viewerImg) viewerImg.style.display = isImg ? "block" : "none";

			if (isPdf && viewerFrame) viewerFrame.src = att.dataUrl;
			if (isImg && viewerImg) viewerImg.src = att.dataUrl;

			viewer.classList.add("show");
			viewer.setAttribute("aria-hidden", "false");
			document.body.classList.add("modal-open");
			return;
		}

		window.open(att.dataUrl, "_blank", "noopener");
		return;
	}

	if (act === "del") {
		openConfirm(
			"Rimuovere allegato?",
			`“${att.name}” verrà rimosso dall'evento.`,
			() => {
				if (ev) {
					ev.attachments = (ev.attachments || []).filter(x => x.id !== attId);
					removeEventById(ev.id);
					ensureDayList(ev.date);
					g_events[ev.date].push(ev);
					saveEvents(g_events);
				} else {
					state.tmpAttachments = (state.tmpAttachments || []).filter(x => x.id !== attId);
					saveState();
				}
				const refreshed = [...(ev?.attachments || []), ...(state.tmpAttachments || [])].filter(x => x.id !== attId);
				renderAttachmentsUI(refreshed);
				toast("Allegato rimosso");
			}
		);
	}
}

/* ---------------------------
   Upsert / Delete
---------------------------- */
export function upsertEvent() {
	const title = $("evTitle").value.trim() || "Senza titolo";
	const date = $("evDate").value;

	const allDay = !!$("evAllDay").checked;

	let startTime = $("evStart").value || "12:00";
	let endTime = $("evEnd").value || "12:30";

	if (!allDay) {
		endTime = clampEndTimeIfNeeded(startTime, endTime);
		$("evEnd").value = endTime;
	}

	const notes = $("evNotes").value.trim();
	const reminders = collectRemindersFromUI();

	if (!date) { toast("Seleziona una data"); return; }

	const newDay = date;
	const newId = state.editEventId || (`ev_${Date.now()}_${Math.floor(Math.random() * 9999)}`);

	let attachments = [];
	if (state.editEventId) {
		const existing = getEventById(state.editEventId);
		attachments = [...(existing?.attachments || []), ...(state.tmpAttachments || [])];
	} else {
		attachments = [...(state.tmpAttachments || [])];
	}

	const evObj = normalizeLegacyEvent({
		id: newId,
		title,
		date: newDay,
		allDay,
		startTime: allDay ? "" : startTime,
		endTime: allDay ? "" : endTime,
		notes,
		reminders,
		attachments
	});

	if (state.editEventId) {
		const old = getEventById(state.editEventId);
		evObj.reminderAck = old?.reminderAck || [];
	}

	if (state.editEventId) {
		removeEventById(state.editEventId);
	}

	ensureDayList(newDay);
	g_events[newDay].push(evObj);

	saveEvents(g_events);

	state.tmpAttachments = [];
	saveState();

	setSelectedDay(parseYMD(newDay));
	closeEventModal();

	// ✅ refresh coerente
	g_events = loadEvents();
	renderCalendar();
	renderDayPanel();

	toast("Evento salvato");
}

export function requestDeleteEvent() {
	const ev = state.editEventId ? getEventById(state.editEventId) : null;
	if (!ev) { toast("Evento non trovato"); return; }

	openConfirm(
		"Eliminare evento?",
		`“${ev.title || "Senza titolo"}” verrà rimosso dal calendario.`,
		() => {
			removeEventById(state.editEventId);

			saveEvents(g_events);

			state.tmpAttachments = [];
			saveState();

			closeEventModal();

			// ✅ refresh coerente
			g_events = loadEvents();
			renderCalendar();
			renderDayPanel();

			toast("Evento eliminato");
		}
	);
}

/* ---------------------------
   Reminders (notifiche confermabili)
---------------------------- */
function reminderToMillis(code) {
	if (!code) return null;
	if (code.endsWith("h")) {
		const n = parseInt(code, 10);
		if (Number.isNaN(n)) return null;
		return n * 60 * 60 * 1000;
	}
	if (code.endsWith("d")) {
		const n = parseInt(code, 10);
		if (Number.isNaN(n)) return null;
		return n * 24 * 60 * 60 * 1000;
	}
	return null;
}

function reminderLabel(code) {
	switch (code) {
		case "1h": return "1 ora prima";
		case "2h": return "2 ore prima";
		case "3h": return "3 ore prima";
		case "1d": return "1 giorno prima";
		case "2d": return "2 giorni prima";
		case "3d": return "3 giorni prima";
		case "4d": return "4 giorni prima";
		case "5d": return "5 giorni prima";
		default: return "Reminder";
	}
}

function listAllEvents() {
	const out = [];
	for (const day of Object.keys(g_events)) {
		for (const ev of (g_events[day] || [])) {
			out.push(normalizeLegacyEvent(ev));
		}
	}
	return out;
}

function computeEventStartDate(ev) {
	if (ev.allDay) {
		const d = parseYMD(ev.date);
		return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0, 0);
	}
	const st = ev.startTime || "12:00";
	return dateTimeFromYmdAndTime(ev.date, st);
}

function getNextDueReminder(now) {
	const events = listAllEvents();

	for (const ev of events) {
		const start = computeEventStartDate(ev);
		const base = start.getTime();

		const rems = Array.isArray(ev.reminders) ? ev.reminders : [];
		const ack = Array.isArray(ev.reminderAck) ? ev.reminderAck : [];

		for (const code of rems) {
			const delta = reminderToMillis(code);
			if (delta == null) continue;

			const due = base - delta;
			if (due > now.getTime()) continue;

			const key = `${ev.id}|${code}|${due}`;
			if (ack.includes(key)) continue;

			const tenDays = 10 * 24 * 60 * 60 * 1000;
			if (now.getTime() - due > tenDays) {
				ack.push(key);
				ev.reminderAck = ack;
				removeEventById(ev.id);
				ensureDayList(ev.date);
				g_events[ev.date].push(ev);
				saveEvents(g_events);
				continue;
			}

			return { ev, code, dueKey: key };
		}
	}

	return null;
}

function showReminderPrompt(rem) {
	const ev = rem.ev;
	const when = reminderLabel(rem.code);

	const title = "Reminder evento";
	const sub = `${when}: “${ev.title}” (${ev.allDay ? "Tutto il giorno" : `${ev.startTime} – ${ev.endTime}`})`;

	openConfirm(
		title,
		sub,
		() => {
			const updated = getEventById(ev.id) || ev;
			const ack = Array.isArray(updated.reminderAck) ? updated.reminderAck : [];
			if (!ack.includes(rem.dueKey)) ack.push(rem.dueKey);
			updated.reminderAck = ack;

			removeEventById(updated.id);
			ensureDayList(updated.date);
			g_events[updated.date].push(updated);
			saveEvents(g_events);

			renderCalendar();
			renderDayPanel();

			toast("Reminder confermato");
		}
	);
}

export function startReminderEngine() {
	if (state._reminderTimerRunning) return;
	state._reminderTimerRunning = true;
	saveState();

	let busy = false;

	setInterval(() => {
		if (busy) return;

		g_events = loadEvents();

		const now = new Date();
		const rem = getNextDueReminder(now);
		if (!rem) return;

		busy = true;
		showReminderPrompt(rem);

		setTimeout(() => { busy = false; }, 600);
	}, 20000);
}

/* ---------------------------
   Bind modal controls (called by app.js)
---------------------------- */
export function bindCalendarModalControls() {
	// ✅ safe guard: se la view calendario non è ancora in DOM non crashare
	if (!$("evAllDay") || !$("evStart") || !$("evEnd")) return;

	$("evAllDay").addEventListener("change", () => {
		setAllDayUI(!!$("evAllDay").checked);
	});

	$("evStart").addEventListener("change", () => {
		if ($("evAllDay").checked) return;
		$("evEnd").value = clampEndTimeIfNeeded($("evStart").value, $("evEnd").value);
	});

	$("evEnd").addEventListener("change", () => {
		if ($("evAllDay").checked) return;
		$("evEnd").value = clampEndTimeIfNeeded($("evStart").value, $("evEnd").value);
	});

	if ($("evFiles")) {
		$("evFiles").addEventListener("change", async (e) => {
			try {
				await onFilesSelected(e.target.files);
			} catch {
				toast("Errore lettura file");
			}
		});
	}

	if ($("evAttachList")) {
		$("evAttachList").addEventListener("click", onAttachmentActionClick);
	}
}
