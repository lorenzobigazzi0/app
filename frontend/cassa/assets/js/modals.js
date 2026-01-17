/* modals.js - station/user + confirm modal helpers */

import { $, toast } from "./dom.js";
import { state, saveState, STATIONS } from "./state.js";

let g_confirmCb = null;
let g_lastFocusEl = null;

/* -------------------------
   Helpers (focus + inert)
-------------------------- */
function setInert(el, on) {
	if (!el) return;
	if (on) {
		el.setAttribute("inert", "");
	} else {
		el.removeAttribute("inert");
	}
}

function rememberFocus() {
	try { g_lastFocusEl = document.activeElement; } catch { g_lastFocusEl = null; }
}

function restoreFocus() {
	try {
		if (g_lastFocusEl && typeof g_lastFocusEl.focus === "function") g_lastFocusEl.focus();
	} catch { /* ignore */ }
	g_lastFocusEl = null;
}

/**
 * Mostra un modal/backdrop generico con focus safety.
 */
export function showModal(id) {
	const el = $(id);
	if (!el) return;

	rememberFocus();

	document.body.classList.add("modal-open");

	// se era inert, riabilitalo
	setInert(el, false);

	el.classList.add("show");
	el.setAttribute("aria-hidden", "false");

	// prova a mettere focus su un elemento sensato nel modal
	const focusable = el.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
	if (focusable && typeof focusable.focus === "function") {
		setTimeout(() => { try { focusable.focus(); } catch { /* ignore */ } }, 0);
	}
}

/**
 * Nasconde un modal/backdrop generico evitando aria-hidden su elemento che contiene focus.
 */
export function hideModal(id) {
	const el = $(id);
	if (!el) return;

	// ✅ se dentro c’è focus, spostalo PRIMA di aria-hidden
	const active = document.activeElement;
	if (active && el.contains(active)) {
		try { active.blur(); } catch { /* ignore */ }
	}

	el.classList.remove("show");
	el.setAttribute("aria-hidden", "true");

	// ✅ inert: impedisce focus/click e risolve warning accessibilità
	setInert(el, true);

	// se non ci sono altri modali aperti, sblocca body + ripristina focus
	const anyOpen = document.querySelector(".modal-backdrop.show, .confirm-backdrop.show, .pin-backdrop.show, .att-viewer-backdrop.show");
	if (!anyOpen) {
		document.body.classList.remove("modal-open");
		restoreFocus();
	}
}

/* -------------------------
   Station modal
-------------------------- */
export function openStationModal() {
	const sel = $("stationSelect");
	if (!sel) return;

	sel.innerHTML = "";
	STATIONS.forEach(s => {
		const o = document.createElement("option");
		o.value = s.label;
		o.textContent = s.label;
		if (s.label === state.stationName) o.selected = true;
		sel.appendChild(o);
	});

	showModal("stationModal");
}

export function closeStationModal() { hideModal("stationModal"); }

export function applyStation() {
	const sel = $("stationSelect");
	state.stationName = sel?.value || state.stationName;
	saveState();
	closeStationModal();
	toast("Location aggiornata");
}

/* -------------------------
   User modal (mock login)
-------------------------- */
export function openUserModal() {
	$("loginName").value = state.userName || "";
	$("loginRole").value = state.userRole || "";
	showModal("userModal");
}

export function closeUserModal() { hideModal("userModal"); }

export function doLogin() {
	const name = $("loginName").value.trim() || "Guest";
	const role = $("loginRole").value.trim() || "Non autenticato";

	state.userName = name;
	state.userRole = role;
	saveState();

	closeUserModal();
	toast("Profilo aggiornato");
}

/* -------------------------
   Logout confirm
-------------------------- */
export function requestLogout() {
	openConfirm(
		"Uscire?",
		"Vuoi effettuare il logout dalla postazione?",
		() => {
			state.userName = "Guest";
			state.userRole = "Non autenticato";
			saveState();
			toast("Logout effettuato");
		}
	);
}

/* -------------------------
   Confirm modal (stack + inert + focus)
-------------------------- */
export function openConfirm(title, sub, onYes) {
	g_confirmCb = (typeof onYes === "function") ? onYes : null;

	$("confirmTitle").textContent = title || "Conferma";
	$("confirmSub").textContent = sub || "—";

	const c = $("confirmModal");
	if (!c) return;

	// porta in cima nello stacking
	document.body.appendChild(c);

	showModal("confirmModal");
}

export function closeConfirm() {
	g_confirmCb = null;
	hideModal("confirmModal");
}

export function confirmYes() {
	const cb = g_confirmCb;
	g_confirmCb = null;
	hideModal("confirmModal");
	try { cb && cb(); } catch { /* ignore */ }
}
