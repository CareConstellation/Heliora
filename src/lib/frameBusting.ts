export const FRAME_BUSTING_SCRIPT = `(function () {
  let hidden = false;

  function blockFraming() {
    if (window.top === window.self) return;

    if (!hidden) {
      hidden = true;
      try {
        window.top.location.replace(window.self.location.href);
      } catch (error) {
        void error;
      }
      document.addEventListener('DOMContentLoaded', function () {
        if (document.body) {
          document.body.replaceChildren();
        }
      });
    }

    if (document.documentElement) {
      document.documentElement.style.display = 'none';
    }
  }

  blockFraming();
  setTimeout(blockFraming, 0);
})();`;
