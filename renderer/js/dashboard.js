window.addEventListener('DOMContentLoaded', async () => {
  $('nav').innerHTML = navHtml('index.html');

  async function refresh() {
    $('status').textContent = 'Atualizando...';
    try {
      const emp = await window.api.getEmployeesPreview(10);
      renderTable('empTable', emp);
      const dep = await window.api.getDependentesPreview(10);
      renderTable('depTable', dep);
      $('status').textContent = 'OK';
    } catch (e) {
      $('status').textContent = 'Erro';
      alert(String(e?.message || e));
    }
  }

  $('btnRefresh').addEventListener('click', refresh);
  refresh();
});
