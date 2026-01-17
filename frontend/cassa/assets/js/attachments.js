/* attachments.js - IndexedDB attachments store */

const DB_NAME = "cr_calendar_db";
const DB_VER = 1;
const STORE = "attachments";

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VER);

		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				const os = db.createObjectStore(STORE, { keyPath: "id" });
				os.createIndex("byEvent", "eventId", { unique: false });
			}
		};

		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function storeTx(db, mode = "readonly") {
	return db.transaction(STORE, mode).objectStore(STORE);
}

export async function addAttachments(eventId, files) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const store = storeTx(db, "readwrite");
		const ids = [];

		let pending = files.length;
		if (pending === 0) { resolve([]); return; }

		for (const f of files) {
			const id = `att_${Date.now()}_${Math.floor(Math.random() * 999999)}`;
			const obj = {
				id,
				eventId,
				name: f.name,
				type: f.type || "application/octet-stream",
				size: f.size || 0,
				createdAt: Date.now(),
				blob: f
			};

			const req = store.put(obj);
			req.onsuccess = () => {
				ids.push(id);
				pending--;
				if (pending === 0) resolve(ids);
			};
			req.onerror = () => reject(req.error);
		}
	});
}

export async function listAttachments(eventId) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const store = storeTx(db, "readonly");
		const idx = store.index("byEvent");
		const req = idx.getAll(eventId);
		req.onsuccess = () => resolve(req.result || []);
		req.onerror = () => reject(req.error);
	});
}

export async function getAttachment(id) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const store = storeTx(db, "readonly");
		const req = store.get(id);
		req.onsuccess = () => resolve(req.result || null);
		req.onerror = () => reject(req.error);
	});
}

export async function deleteAttachment(id) {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const store = storeTx(db, "readwrite");
		const req = store.delete(id);
		req.onsuccess = () => resolve(true);
		req.onerror = () => reject(req.error);
	});
}

export async function deleteAttachmentsByEvent(eventId) {
	const all = await listAttachments(eventId);
	for (const a of all) {
		await deleteAttachment(a.id);
	}
}
