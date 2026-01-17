import { $, toast } from "./dom.js";
import { DEFAULT_PIN } from "./state.js";
import { showModal, hideModal } from "./modals.js";
import { setLockedUI } from "./ui.js";

let pinBuffer = "";
let pinMode = "unlock"; // "lock" or "unlock"

function resetPinDots() {
	pinBuffer = "";
	document.querySelectorAll("#pinDots .dot").forEach(d => d.classList.remove("filled"));
}

function updatePinDots() {
	const dots = document.querySelectorAll("#pinDots .dot");
	dots.forEach((d, i) => d.classList.toggle("filled", i < pinBuffer.length));
}

export function openPinModal(mode) {
	pinMode = mode;
	resetPinDots();

	if (mode === "unlock") {
		$("pinTitle").textContent = "Inserisci PIN";
		$("pinSub").textContent = "PIN richiesto per sbloccare";
		$("pinIcon").innerHTML = `<i class="fa-solid fa-lock"></i>`;
	} else {
		$("pinTitle").textContent = "Inserisci PIN";
		$("pinSub").textContent = "PIN richiesto per bloccare";
		$("pinIcon").innerHTML = `<i class="fa-solid fa-shield-halved"></i>`;
	}
	showModal("pinModal");
}

export function closePinModal() { hideModal("pinModal"); }

function verifyPinAndApply() {
	if (pinBuffer !== DEFAULT_PIN) {
		toast("PIN errato");
		resetPinDots();
		return;
	}

	if (pinMode === "unlock") {
		setLockedUI(false);
		toast("Cassa sbloccata");
	} else {
		setLockedUI(true);
		toast("Cassa bloccata");
	}
	closePinModal();
}

export function onPinKey(k) {
	if (k === "back") {
		pinBuffer = pinBuffer.slice(0, -1);
		updatePinDots();
		return;
	}
	if (k === "cancel") {
		closePinModal();
		return;
	}

	if (pinBuffer.length >= 4) return;
	pinBuffer += String(k);
	updatePinDots();

	if (pinBuffer.length === 4) {
		setTimeout(verifyPinAndApply, 120);
	}
}
