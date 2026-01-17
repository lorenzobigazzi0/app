export const $ = (id) => document.getElementById(id);

export function pad2(n) { return String(n).padStart(2, "0"); }

export function toast(msg) {
	const el = $("toast");
	el.textContent = msg;
	el.classList.add("show");
	clearTimeout(toast._t);
	toast._t = setTimeout(() => el.classList.remove("show"), 1600);
}

export function ymd(d) {
	const y = d.getFullYear();
	const m = pad2(d.getMonth() + 1);
	const dd = pad2(d.getDate());
	return `${y}-${m}-${dd}`;
}

export function parseYMD(s) {
	const [y, m, d] = s.split("-").map(Number);
	return new Date(y, (m - 1), d, 0, 0, 0, 0);
}

export function formatItalianDate(d) {
	const months = [
		"Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno",
		"Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"
	];
	return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function weekdayItalian(d) {
	const days = ["Domenica","Lunedì","Martedì","Mercoledì","Giovedì","Venerdì","Sabato"];
	return days[d.getDay()];
}
