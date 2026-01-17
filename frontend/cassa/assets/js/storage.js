export function safeJsonParse(raw, fallback) {
	try {
		return JSON.parse(raw);
	} catch {
		return fallback;
	}
}

export function loadFromStorage(key, fallback) {
	const raw = localStorage.getItem(key);
	if (!raw) return fallback;
	return safeJsonParse(raw, fallback);
}

export function saveToStorage(key, value) {
	localStorage.setItem(key, JSON.stringify(value));
}
