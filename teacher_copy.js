// Plan B for the teacher flow: when a save to the server fails, let the teacher
// copy the record as text and send it to the researcher (e.g. WeChat).
// deploy/import_teacher_paste.py turns the pasted text back into the same
// teacher_form/孩子_老师_时间.{json,csv} files the server would have written.
(function () {
  const HEADER = 'SENSE老师数据（请把这一整段原样发给研究员）';

  function toText(record) {
    return HEADER + '\n' + JSON.stringify(record);
  }

  async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  // Renders the fallback box inside `container` (replacing its content).
  function showCopyFallback(container, record) {
    const text = toText(record);
    container.innerHTML = `
      <div class="copy-fallback" style="margin-top:0.8rem;padding:0.8rem 0.9rem;border-radius:10px;
        background:#fff6e0;border:1px solid #e8c983;color:#5a4410;font-size:0.92rem;line-height:1.5;text-align:left;">
        <div><b>如果一直提交不了：</b>请点下面的按钮复制数据，然后用微信发给研究员。您填的内容不会丢失。</div>
        <button type="button" class="copy-fallback-btn" style="margin-top:0.6rem;padding:0.6rem 1rem;font-size:1rem;
          border-radius:8px;border:none;background:#c9a24a;color:#fff;font-weight:600;cursor:pointer;">复制数据</button>
        <span class="copy-fallback-status" style="margin-left:0.6rem;"></span>
        <textarea class="copy-fallback-text" readonly style="display:block;width:100%;height:7em;margin-top:0.6rem;
          font-size:0.75rem;border-radius:6px;border:1px solid #ddd;padding:0.4rem;box-sizing:border-box;"></textarea>
      </div>`;
    const btn = container.querySelector('.copy-fallback-btn');
    const status = container.querySelector('.copy-fallback-status');
    const box = container.querySelector('.copy-fallback-text');
    box.value = text;
    btn.onclick = async () => {
      const ok = await copy(text);
      if (ok) {
        status.textContent = '已复制 ✓ 请粘贴到微信发给研究员';
      } else {
        status.textContent = '没能自动复制，请长按下面框里的文字，全选后复制';
        box.focus();
        box.select();
      }
      try { window.logEvent?.('teacher_copy_fallback', { copied: ok }); } catch (_) {}
    };
  }

  window.SENSECopy = { showCopyFallback, toText };
})();
