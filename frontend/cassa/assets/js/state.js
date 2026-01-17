/* state.js - local state + events persistence */

const LS_STATE_KEY = "cr_state_v1";
const LS_EVENTS_KEY = "cr_events_v1";

/* ------------------------------------------------------------------
 * Export richiesti da modals.js (compat)
 * ------------------------------------------------------------------ */
export const DEFAULT_PIN = "0000";

export const STATIONS = [
	{ id: "main", label: "CASSA PRINCIPALE" },
	{ id: "bar", label: "BANCO BAR" },
	{ id: "sala", label: "SALA" },
	{ id: "esterno", label: "ESTERNO" }
];

/* ------------------------------------------------------------------
 * Stato applicazione
 * ------------------------------------------------------------------ */
export const state = {
	route: "calendario",

	darkMode: true,
	locked: false,
	stationActive: true,

	calCursor: new Date(),
	selectedDay: new Date(),

	stationName: "CASSA PRINCIPALE",
	userName: "Guest",
	userRole: "Non autenticato",

	editEventId: null,

	// tmp attachments while creating/editing before save
	tmpAttachments: [],

	// internal flag: avoid duplicate reminder timers
	_reminderTimerRunning: false
};

export function loadState() {
	try {
		const raw = localStorage.getItem(LS_STATE_KEY);
		if (!raw) return;

		const obj = JSON.parse(raw);
		Object.assign(state, obj);

		// revive Date objects
		if (typeof state.calCursor === "string") state.calCursor = new Date(state.calCursor);
		if (typeof state.selectedDay === "string") state.selectedDay = new Date(state.selectedDay);

		// ensure arrays
		if (!Array.isArray(state.tmpAttachments)) state.tmpAttachments = [];
	} catch {
		// keep defaults
	}
}

export function saveState() {
	try {
		const toSave = {
			...state,
			calCursor: (state.calCursor instanceof Date) ? state.calCursor.toISOString() : state.calCursor,
			selectedDay: (state.selectedDay instanceof Date) ? state.selectedDay.toISOString() : state.selectedDay
		};
		localStorage.setItem(LS_STATE_KEY, JSON.stringify(toSave));
	} catch {
		// ignore
	}
}

/* ---------------------------
   Events persistence
---------------------------- */
export function loadEvents() {
	try {
		const raw = localStorage.getItem(LS_EVENTS_KEY);
		if (!raw) return {};
		const obj = JSON.parse(raw);
		return (obj && typeof obj === "object") ? obj : {};
	} catch {
		return {};
	}
}

export function saveEvents(eventsObj) {
	try {
		localStorage.setItem(LS_EVENTS_KEY, JSON.stringify(eventsObj || {}));
	} catch {
		// ignore
	}
}
