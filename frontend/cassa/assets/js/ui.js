import { $, toast } from "./dom.js";
import { state, saveState } from "./state.js";

export function renderHeader() {
	$("stationValue").textContent = state.stationName;

	$("userNameText").textContent = state.loggedIn ? state.userName : "Guest";
	$("userRoleText").textContent = state.loggedIn ? state.userRole : "Non autenticato";

	const initials = state.loggedIn
		? (state.userName.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join(""))
		: "G";
	$("avatarCircle").textContent = initials || "G";

	$("systemText").textContent = state.stationActive ? "ONLINE" : "PAUSA";
	$("systemDot").style.animationPlayState = state.stationActive ? "running" : "paused";

	const st = $("stationToggle");
	if (st.checked !== state.stationActive) st.checked = state.stationActive;

	const dt = $("darkToggle");
	dt.checked = !!state.darkMode;
	document.body.setAttribute("data-theme", state.darkMode ? "dark" : "light");

	const icon = $("lockBtnIcon");
	icon.className = state.locked ? "fa-solid fa-lock" : "fa-solid fa-lock-open";
}

export function applyPauseUI() {
	const overlay = $("pauseOverlay");
	overlay.style.display = state.stationActive ? "none" : "flex";
	overlay.setAttribute("aria-hidden", state.stationActive ? "true" : "false");
}

/**
 * Regola LOCK:
 * - Quando locked: TUTTO disabilitato tranne il pulsante lucchetto.
 * - Quindi anche: darkToggle e logoutBtn sono vincolati (DISABILITATI).
 */
export function setLockedUI(isLocked) {
	state.locked = !!isLocked;
	saveState();

	const lockOn = state.locked;

	const lockOverlay = $("lockOverlay");
	lockOverlay.style.display = lockOn ? "flex" : "none";
	lockOverlay.setAttribute("aria-hidden", lockOn ? "false" : "true");

	const icon = $("lockBtnIcon");
	icon.className = lockOn ? "fa-solid fa-lock" : "fa-solid fa-lock-open";

	const stationToggle = $("stationToggle");
	const stationSelector = $("stationSelector");
	const userProfile = $("userProfile");
	const darkToggle = $("darkToggle");
	const logoutBtn = $("logoutBtn");

	stationToggle.disabled = lockOn;
	darkToggle.disabled = lockOn;
	logoutBtn.disabled = lockOn;

	stationToggle.style.pointerEvents = lockOn ? "none" : "";
	stationSelector.style.pointerEvents = lockOn ? "none" : "";
	userProfile.style.pointerEvents = lockOn ? "none" : "";
	darkToggle.style.pointerEvents = lockOn ? "none" : "";
	logoutBtn.style.pointerEvents = lockOn ? "none" : "";

	document.querySelectorAll("aside.sidebar, section.content").forEach(el => {
		el.style.pointerEvents = lockOn ? "none" : "";
		el.style.userSelect = lockOn ? "none" : "";
	});

	["stationModal", "userModal", "eventModal", "confirmModal"].forEach(id => {
		const el = $(id);
		if (el) el.style.pointerEvents = lockOn ? "none" : "";
	});

	const lockBtn = $("lockBtn");
	lockBtn.disabled = false;
	lockBtn.style.pointerEvents = "";
}

export function applyThemeFromToggle() {
	state.darkMode = !!$("darkToggle").checked;
	saveState();
	renderHeader();
	toast(state.darkMode ? "Dark mode" : "Light mode");
}
