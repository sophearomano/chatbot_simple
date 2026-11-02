// Add the bot to any website with one line:
// <script src="https://your-bot-address/widget.js" defer></script>
(function () {
  const origin = new URL(document.currentScript.src).origin;
  const button = document.createElement('button');
  const frame = document.createElement('iframe');
  let open = false;

  button.setAttribute('aria-label', 'Open chat');
  button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;border:0;border-radius:50%;cursor:pointer;background:radial-gradient(circle at 32% 30%,#f3b78f,#b4532a 62%);box-shadow:0 6px 20px rgba(0,0,0,.28)';

  frame.title = 'Chat';
  frame.src = `${origin}/?embed=1`;
  frame.style.cssText = 'position:fixed;right:20px;bottom:88px;z-index:2147483000;width:min(400px,calc(100vw - 40px));height:min(620px,calc(100dvh - 120px));border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);display:none';

  button.addEventListener('click', () => {
    open = !open;
    frame.style.display = open ? 'block' : 'none';
    button.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
  });

  document.body.append(frame, button);
})();
