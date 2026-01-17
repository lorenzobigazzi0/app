(() => {
	const $ = (id) => document.getElementById(id);
	const pad2 = (n) => String(n).padStart(2, '0');

	let g_token = '';
	let g_ws = null;

	function setSystem(ok){
		$('systemText').textContent = ok ? 'ONLINE' : 'OFFLINE';
		$('systemDot').style.animationPlayState = ok ? 'running' : 'paused';
	}

	function renderClock(){
		const now = new Date();
		const months = ["GENNAIO","FEBBRAIO","MARZO","APRILE","MAGGIO","GIUGNO","LUGLIO","AGOSTO","SETTEMBRE","OTTOBRE","NOVEMBRE","DICEMBRE"];
		$('dateText').textContent = `${pad2(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()}`;
		$('timeText').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
	}

	function themeApply(){
		const dark = $('darkToggle').checked;
		document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
	}

	async function api(path, opts={}){
		const headers = Object.assign({ 'Content-Type':'application/json' }, opts.headers || {});
		if (g_token) headers['Authorization'] = `Bearer ${g_token}`;
		const res = await fetch(path, { ...opts, headers });
		if (!res.ok) throw new Error(await res.text());
		return res.json();
	}

	function addEvent(line){
		const wrap = $('events');
		const card = document.createElement('div');
		card.className = 'card mono';
		card.textContent = line;
		wrap.prepend(card);
		while (wrap.children.length > 50) wrap.removeChild(wrap.lastChild);
	}

	function orderCard(o){
		const items = (o.items || []).map(it => `${it.is_done ? '✓' : '•'} x${it.qty} ${it.name}${it.note ? ' ('+it.note+')' : ''}`).join('\n');
		return `#${o.public_id}  T${o.table_number}  ${o.waiter_name}\n${o.status}\n${items}`;
	}

	function renderOrders(list){
		const wrap = $('orders');
		wrap.innerHTML = '';
		(list || []).forEach(o => {
			const c = document.createElement('div');
			c.className = 'card mono';
			c.textContent = orderCard(o);
			wrap.appendChild(c);
		});
	}

	async function refreshOrders(){
		const list = await api('/api/orders');
		renderOrders(list);
	}

	function wsConnect(){
		if (g_ws) try { g_ws.close(); } catch(e) {}
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(g_token)}&channel=admin`;
		g_ws = new WebSocket(url);
		g_ws.onopen = () => { setSystem(true); addEvent(`[WS] connected`); };
		g_ws.onclose = () => { setSystem(false); addEvent(`[WS] closed`); };
		g_ws.onerror = () => { setSystem(false); addEvent(`[WS] error`); };
		g_ws.onmessage = (ev) => {
			let msg = null;
			try { msg = JSON.parse(ev.data); } catch(e) { return; }
			if (msg.type === 'order_created' || msg.type === 'order_updated') {
				refreshOrders().catch(()=>{});
				addEvent(`[${msg.type}] #${msg.order?.public_id || '?'}`);
			}
			if (msg.type === 'call_created') {
				addEvent(`[call] ${msg.call?.call_type} id=${msg.call?.id}`);
			}
			if (msg.type === 'print_job') {
				addEvent(`[print] #${msg.public_id} ok=${msg.ok}`);
			}
		};

		// keepalive
		setInterval(() => {
			if (g_ws && g_ws.readyState === 1) g_ws.send('ping');
		}, 15000);
	}

	async function doLogin(){
		const username = $('username').value.trim();
		const password = $('password').value;
		try{
			const tok = await api('/api/auth/login', { method:'POST', body: JSON.stringify({username, password}) , headers: {} });
			g_token = tok.access_token;
			$('tokenState').textContent = 'token OK';
			$('tokenState').style.opacity = '1';
			await refreshOrders();
			wsConnect();
			addEvent('[auth] login OK');
		}catch(e){
			$('tokenState').textContent = 'login FAIL';
			addEvent(`[auth] ${String(e)}`);
		}
	}

	$('btnLogin').addEventListener('click', doLogin);
	$('darkToggle').addEventListener('change', themeApply);

	themeApply();
	renderClock();
	setInterval(renderClock, 1000);
	setSystem(false);
})();
