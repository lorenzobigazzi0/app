/* reminders.js - reminder scheduler + acknowledge */

import { openConfirm } from "./modals.js";
import { toast } from "./dom.js";

const ACK_KEY = "cr_v1_reminder_ack";

/* Offset */
function reminderOffsetMs(code) {
	if (!code) return null;
	if (code === "h1") return 1 * 60 * 60 * 1000;
	if (code === "h2") return 2 * 60 * 60 * 1000;
	if (code === "h3") return 3 * 60 * 60 * 1000;
	if (code === "d1") return 1 * 24 * 60 * 60 * 1000;
	if (code === "d2") return 2 * 24 * 60 * 60 * 1000;
	if (code === "d3") return 3 * 24 * 60 * 60 * 1000;
	if (code === "d4") return 4 * 24 * 60 * 60 * 1000;
	if (code === "d5") return 5 * 24 * 60 * 60 * 1000;
	return null;
}

function codeLabel(code) {
	const m = {
		h1: "1 ora prima",
		h2: "2 ore prima",
		h3: "3 ore prima",
		d1: "1 giorno prima",
		d2: "2 giorni prima",
		d3: "3 giorni prima",
		d4: "4 giorni prima",
		d5: "5 giorni prima"
	};
	return m[code] || "Reminder";
}

function loadAck() {
	try {
		return JSON.parse(localStorage.getItem(ACK_KEY) || "{}") || {};
	} catch {
		return {};
	}
}

function saveAck(map) {
	localStorage.setItem(ACK_KEY, JSON.stringify(map));
}

function buildDueReminders(eventsMap) {
	const due = [];
	const now = Date.now();

	Object.keys(eventsMap || {}).forEach(day => {
		const list = eventsMap[day] || [];
		list.forEach(ev => {
			const startMs = ev.startMs;
			const rems = Array.isArray(ev.reminders) ? ev.reminders : [];

			rems.forEach(code => {
				const off = reminderOffsetMs(code);
				if (!off) return;

				const when = startMs - off;
				if (when > now) return;

				const id = `rem_${ev.id}_${code}_${startMs}`;

				due.push({
					id,
					when,
					code,
					title: ev.title || "Evento",
					date: ev.date,
					allDay: !!ev.allDay,
					start: ev.start,
					end: ev.end
				});
			});
		});
	});

	due.sort((a, b) => a.when - b.when);
	return due;
}

function openReminderConfirm(rem) {
	return new Promise((resolve) => {
		const timeTxt = rem.allDay ? "Tutto il giorno" : `${rem.start || "—"} – ${rem.end || "—"}`;
		openConfirm(
			"Reminder",
			`${codeLabel(rem.code)} • ${rem.title}\n${rem.date} • ${timeTxt}\n\nConferma per chiudere.`,
			() => resolve(true)
		);
	});
}

export function startReminderLoop(eventsMapGetter) {
	let busy = false;

	async function tick() {
		if (busy) return;
		busy = true;

		try {
			const ack = loadAck();
			const eventsMap = eventsMapGetter?.() || {};
			const due = buildDueReminders(eventsMap);

			for (const rem of due) {
				if (ack[rem.id]) continue;

				await openReminderConfirm(rem);
				ack[rem.id] = true;
				saveAck(ack);
				toast("Reminder confermato");
			}
		} finally {
			busy = false;
		}
	}

	tick();
	setInterval(tick, 30_000);
}
