import { $, pad2, formatItalianDate } from "./dom.js";

export function renderClock() {
	const now = new Date();
	$("dateText").textContent = formatItalianDate(now);
	$("timeText").textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}
