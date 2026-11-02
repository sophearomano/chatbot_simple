(function () {
  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const input = $('input');
  const send = $('send');
  const params = new URLSearchParams(location.search);
  if (params.has('embed')) document.body.classList.add('embed');

  const CHANNEL_LABELS = { whatsapp: 'on WhatsApp', device: 'on another device' };
  let token = readToken();
  let running = null;

  function readToken() {
    try { return localStorage.getItem('bot-token'); } catch { return null; }
  }
  function storeToken(value) {
    token = value;
    try {
      if (value) localStorage.setItem('bot-token', value);
      else localStorage.removeItem('bot-token');
    } catch { /* The token then lasts as long as the page. */ }
  }

  async function ensureSession(accessCode) {
    if (token) return true;
    const response = await fetch('api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessCode }),
    });
    if (response.status === 403) {
      const code = prompt('This assistant is private. Enter the access code:');
      return code ? ensureSession(code) : false;
    }
    if (!response.ok) return false;
    storeToken((await response.json()).token);
    return true;
  }

  const authorised = (accept) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: accept });

  async function call(path, options) {
    if (!(await ensureSession())) throw new Error('No session');
    const go = () => fetch(path, { ...options, headers: authorised(options?.accept ?? 'application/json') });
    let response = await go();
    if (response.status === 401) {
      storeToken(null);
      if (!(await ensureSession())) throw new Error('No session');
      response = await go();
    }
    return response;
  }

  const scrollDown = () => { log.scrollTop = log.scrollHeight; };
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;

  function addMessage(role, text, channel) {
    $('welcome').hidden = true;
    const wrap = document.createElement('article');
    wrap.className = `message ${role}`;
    const body = document.createElement('div');
    if (role === 'user') {
      body.textContent = text;
    } else {
      body.className = 'body';
      body.innerHTML = renderMarkdown(text);
    }
    wrap.append(body);
    if (CHANNEL_LABELS[channel] && role === 'user') {
      const from = document.createElement('span');
      from.className = 'from';
      from.textContent = CHANNEL_LABELS[channel];
      body.append(from);
    }
    log.append(wrap);
    scrollDown();
    return wrap;
  }

  async function readEvents(response, handlers) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(chunk)?.[1];
        const data = /^data: (.+)$/m.exec(chunk)?.[1];
        if (event && data) handlers[event]?.(JSON.parse(data));
      }
    }
  }

  function setRunning(controller) {
    running = controller;
    send.classList.toggle('stop', Boolean(controller));
    send.setAttribute('aria-label', controller ? 'Stop' : 'Send');
    refreshSend();
  }
  function refreshSend() { send.disabled = !running && !input.value.trim(); }

  async function ask(text) {
    addMessage('user', text);
    const wrap = addMessage('assistant', '');
    const body = wrap.querySelector('.body');
    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = 'Thinking';
    wrap.prepend(status);

    let written = '';
    let frame = 0;
    const paint = () => {
      frame = 0;
      const follow = nearBottom();
      body.innerHTML = renderMarkdown(written);
      if (follow) scrollDown();
    };
    const controller = new AbortController();
    setRunning(controller);
    try {
      const response = await call('api/chat', {
        method: 'POST',
        accept: 'text/event-stream',
        body: JSON.stringify({ message: text, channel: 'web' }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).error);
      await readEvents(response, {
        text({ delta }) {
          status.hidden = true;
          written += delta;
          frame ||= requestAnimationFrame(paint);
        },
        status({ status: label }) {
          status.textContent = label;
          status.hidden = false;
        },
        done(result) {
          if (result.linked) location.reload();
          if (result.cleared) reset();
          if (result.failed) wrap.classList.add('failed');
          if (!written && result.text) written = result.text;
        },
      });
      cancelAnimationFrame(frame);
      paint();
      status.remove();
    } catch (error) {
      status.remove();
      if (error.name === 'AbortError') {
        if (!written) wrap.remove();
      } else {
        wrap.classList.add('failed');
        body.textContent = error.message === 'No session' ? 'I could not start a session.' : 'I could not reach the server. Please try again.';
      }
    } finally {
      setRunning(null);
      input.focus();
    }
  }

  function reset() {
    log.querySelectorAll('.message').forEach((node) => node.remove());
    $('welcome').hidden = false;
  }

  async function command(text) {
    const response = await call('api/chat', { method: 'POST', body: JSON.stringify({ message: text, channel: 'web' }) });
    return response.json();
  }

  async function loadHistory() {
    if (!token) return;
    const response = await call('api/history');
    if (!response.ok) return;
    const { messages } = await response.json();
    for (const line of messages) addMessage(line.role, line.text, line.channel);
  }

  $('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    if (running) return running.abort();
    const text = input.value.trim();
    if (!text) return undefined;
    input.value = '';
    input.style.height = '';
    refreshSend();
    return ask(text);
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
    refreshSend();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $('composer').requestSubmit();
    }
  });

  document.querySelectorAll('.ideas button').forEach((button) => {
    button.addEventListener('click', () => { if (!running) ask(button.textContent); });
  });

  $('new-chat').addEventListener('click', async () => {
    if (running) running.abort();
    await command('/new');
    reset();
    input.focus();
  });

  const dialog = $('device-dialog');
  $('devices').addEventListener('click', () => {
    $('code-result').hidden = true;
    $('join-result').hidden = true;
    dialog.showModal();
  });
  $('close-dialog').addEventListener('click', () => dialog.close());
  $('make-code').addEventListener('click', async () => {
    const { text } = await command('/link');
    $('code-result').textContent = text;
    $('code-result').hidden = false;
  });
  $('join-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = $('join-code').value.trim();
    if (!code) return;
    const { text, linked } = await command(`/link ${code}`);
    $('join-result').textContent = text;
    $('join-result').hidden = false;
    if (linked) location.reload();
  });

  fetch('api/info').then((response) => response.json()).then(({ name }) => {
    document.title = name;
    $('bot-name').textContent = name;
    input.placeholder = `Message ${name}`;
  }).catch(() => {});

  refreshSend();
  loadHistory().catch(() => {});
})();
