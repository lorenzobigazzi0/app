/* app.js - entrypoint */

import { $, toast } from "./dom.js";
import { state, loadState, saveState } from "./state.js";
import { renderClock } from "./clock.js";
import {
	renderHeader,
	applyPauseUI,
	setLockedUI,
	applyThemeFromToggle
} from "./ui.js";
import { setRoute } from "./router.js";
import {
	openStationModal,
	closeStationModal,
	applyStation,
	openUserModal,
	closeUserModal,
	doLogin,
	requestLogout,
	closeConfirm,
	confirmYes,
	hideModal
} from "./modals.js";
import { openPinModal, onPinKey } from "./pin.js";
import {
	renderCalendar,
	renderDayPanel,
	setCalendarCursorTo,
	setSelectedDay,
	openEventModal,
	closeEventModal,
	upsertEvent,
	requestDeleteEvent,
	startReminderEngine,
	bindCalendarModalControls
} from "./calendar.js";

/* ------------------------------------------------------------------
 * Bind eventi UI
 * ------------------------------------------------------------------ */
function bind() {
	/* Toggle postazione */
	$("stationToggle").addEventListener("change", function () {
		state.stationActive = !!this.checked;
		saveState();
		renderHeader();
		applyPauseUI();
		toast(state.stationActive ? "Postazione attiva" : "Postazione in pausa");
	});

	/* Lock / Unlock */
	$("lockBtn").addEventListener("click", () => {
		openPinModal(state.locked ? "unlock" : "lock");
	});

	/* Tema */
	$("darkToggle").addEventListener("change", applyThemeFromToggle);

	/* Logout */
	$("logoutBtn").addEventListener("click", () => requestLogout());

	/* Modale location */
	$("stationSelector").addEventListener("click", openStationModal);
	$("btnCloseStationModal").addEventListener("click", closeStationModal);
	$("btnCancelStation").addEventListener("click", closeStationModal);
	$("btnApplyStation").addEventListener("click", applyStation);

	/* Modale utente */
	$("userProfile").addEventListener("click", openUserModal);
	$("btnCloseUserModal").addEventListener("click", closeUserModal);
	$("btnDoLogin").addEventListener("click", doLogin);

	/* Click fuori dai modali */
	["stationModal", "userModal", "eventModal", "confirmModal", "pinModal"].forEach(id => {
		const el = $(id);
		if (!el) return;
		el.addEventListener("click", (e) => {
			if (e.target.id === id) hideModal(id);
		});
	});

	/* Confirm */
	$("confirmNoBtn").addEventListener("click", closeConfirm);
	$("confirmYesBtn").addEventListener("click", confirmYes);

	/* PIN keypad */
	$("pinPad").addEventListener("click", (e) => {
		const btn = e.target.closest("button");
		if (!btn) return;

		if (btn.id === "pinCancelBtn") { onPinKey("cancel"); return; }
		if (btn.id === "pinBackBtn") { onPinKey("back"); return; }

		const k = btn.dataset.key;
		if (k != null) onPinKey(k);
	});

	/* Calendario */
	$("btnToday").addEventListener("click", () => {
		const now = new Date();
		setCalendarCursorTo(now);
		setSelectedDay(now);
		toast("Oggi");
	});

	$("btnPrevMonth").addEventListener("click", () => {
		const d = new Date(state.calCursor);
		d.setMonth(d.getMonth() - 1);
		setCalendarCursorTo(d);

		const s = new Date(state.selectedDay);
		const ns = new Date(d.getFullYear(), d.getMonth(), Math.min(s.getDate(), 28));
		setSelectedDay(ns);
	});

	$("btnNextMonth").addEventListener("click", () => {
		const d = new Date(state.calCursor);
		d.setMonth(d.getMonth() + 1);
		setCalendarCursorTo(d);

		const s = new Date(state.selectedDay);
		const ns = new Date(d.getFullYear(), d.getMonth(), Math.min(s.getDate(), 28));
		setSelectedDay(ns);
	});

	$("btnNewEvent").addEventListener("click", () => openEventModal("new"));
	$("btnAddForDay").addEventListener("click", () => openEventModal("new"));
	$("btnCloseEventModal").addEventListener("click", closeEventModal);
	$("btnSaveEvent").addEventListener("click", upsertEvent);
	$("btnDeleteEvent").addEventListener("click", requestDeleteEvent);

	// Bind dei nuovi controlli dentro il modal evento (all-day, attachments, etc.)
	bindCalendarModalControls();

	/* Router sidebar */
	document.querySelectorAll(".nav-btn").forEach(b => {
		b.addEventListener("click", () => setRoute(b.dataset.route));
	});
}

/* ------------------------------------------------------------------
 * Init applicazione
 * ------------------------------------------------------------------ */
function init() {
	/* Stato */
	loadState();

	/* Sanificazione date */
	if (!(state.calCursor instanceof Date) || Number.isNaN(state.calCursor.getTime())) {
		state.calCursor = new Date();
	}
	if (!(state.selectedDay instanceof Date) || Number.isNaN(state.selectedDay.getTime())) {
		state.selectedDay = new Date();
	}

	state.calCursor = new Date(
		state.calCursor.getFullYear(),
		state.calCursor.getMonth(),
		1, 0, 0, 0, 0
	);

	state.selectedDay = new Date(
		state.selectedDay.getFullYear(),
		state.selectedDay.getMonth(),
		state.selectedDay.getDate(),
		0, 0, 0, 0
	);

	if (!state.route) state.route = "calendario";

	/* Tema */
	document.body.setAttribute("data-theme", state.darkMode ? "dark" : "light");

	/* Header + clock */
	renderHeader();
	renderClock();
	setInterval(renderClock, 1000);

	/* Pause / lock */
	applyPauseUI();
	setLockedUI(!!state.locked);

	/* Bind UI */
	bind();

	/* Routing iniziale */
	setRoute(state.route);

	/* Calendario */
	if (state.route === "calendario") {
		renderCalendar();
		renderDayPanel();
	}

	/* Reminder engine */
	startReminderEngine();
}

/* Bootstrap */
init();
