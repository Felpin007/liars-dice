// App bootstrap — inicializa os modulos da aplicacao
(() => {
  const app = window.LDAApp;

  window.addEventListener("DOMContentLoaded", async () => {
    app.bindUi();
    app.setScreen(false);
    await app.initSupabase();
    await app.bootstrapOnline();
  });
})();
