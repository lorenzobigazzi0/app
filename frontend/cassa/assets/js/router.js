import { state, saveState } from "./state.js";
import { renderCalendar, renderDayPanel } from "./calendar.js";

export function setRoute(route) {
	state.route = route;
	saveState();

	document.querySelectorAll(".view").forEach(v => v.hidden = true);
	const view = document.querySelector(`#view-${route}`);
	if (view) view.hidden = false;

	document.querySelectorAll(".nav-btn").forEach(b => {
		b.classList.toggle("active", b.dataset.route === route);
	});

	if (route === "calendario") {
		renderCalendar();
		renderDayPanel();
	}
}
