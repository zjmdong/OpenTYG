/**
 * pages/login.js — 登录页
 * 契约：docs/api.md
 *  短信登录：手机号 → 点「获取验证码」弹窗填图形码（官方接口强制）→ 收到短信码 → 登录
 *    · 表单默认只有「手机号」与「短信验证码（含获取按钮）」两项，不预先露出图形码
 *    · 弹窗内的图形码图片点一下即换一张
 *  密码登录：账号 + 密码；DEVICE_VERIFICATION_REQUIRED 时展开「换设备短信码」后重试
 *  记住登录：默认勾选
 */

import { api } from '../api.js';
import { store } from '../store.js';
import { ICON } from '../icons.js';
import { esc, guard, toast, confirmDialog } from '../ui.js';

const MOBILE_RE = /^1\d{10}$/;

export default {
  path: '/login',
  tabbar: false,

  render(ctx) {
    const root = ctx.root;

    let tab = 'sms';
    let captcha = null;          // { challengeId, imageUrl, mobile }
    let smsCountdown = 0;
    let countdownTimer = null;

    root.innerHTML = `
      <div class="page page--login">
        <div class="page-body">
          <div class="login-body">
            <div class="login-hero">
              <div class="login-hero__logo">${ICON.lock}</div>
              <div class="login-hero__brand">
                <div class="login-hero__title">OpenTYG</div>
                <div class="login-hero__sub">手机开门 · 智能门禁</div>
              </div>
            </div>
            <div class="tabs" role="tablist">
              <button type="button" class="tab-item is-active" data-tab="sms" role="tab">短信登录</button>
              <button type="button" class="tab-item" data-tab="password" role="tab">账号密码登录</button>
            </div>


            <!-- 短信登录：只保留手机号 + 短信验证码两项 -->
            <form class="form" id="sms-form" autocomplete="on" novalidate>
              <div class="field">
                <label class="field__label" for="sms-mobile">手机号</label>
                <input class="input" id="sms-mobile" name="mobile" type="tel" inputmode="numeric"
                       maxlength="11" placeholder="请输入手机号" autocomplete="tel">
              </div>

              <div class="field">
                <label class="field__label" for="sms-code">短信验证码</label>
                <div class="field__row">
                  <input class="input" id="sms-code" name="smsCode" type="text" inputmode="numeric"
                         maxlength="8" placeholder="请输入短信验证码" autocomplete="one-time-code">
                  <button type="button" class="btn btn--ghost" id="sms-send">获取验证码</button>
                </div>
              </div>

              <div id="sms-error" class="form-error is-hidden"></div>

              <label class="check">
                <input type="checkbox" id="sms-remember" checked>
                <span>记住登录（30 天内免登录）</span>
              </label>

              <button type="submit" class="btn btn--primary btn--block" id="sms-submit">登录</button>
            </form>

            <!-- 账号密码登录 -->
            <form class="form is-hidden" id="pw-form" autocomplete="on" novalidate>
              <div class="field">
                <label class="field__label" for="pw-account">账号</label>
                <input class="input" id="pw-account" name="account" type="text"
                       placeholder="手机号 / 账号" autocomplete="username">
              </div>

              <div class="field">
                <label class="field__label" for="pw-password">密码</label>
                <input class="input" id="pw-password" name="password" type="password"
                       placeholder="请输入密码" autocomplete="current-password">
              </div>

              <div class="field is-hidden" id="pw-device-field">
                <label class="field__label" for="pw-device-code">换设备短信码</label>
                <input class="input" id="pw-device-code" name="changeDeviceSmsCode" type="text"
                       inputmode="numeric" maxlength="8" placeholder="请输入换设备短信验证码"
                       autocomplete="one-time-code">
                <div class="field__hint">该账号在新设备登录，需要短信验证码验证身份后再试。</div>
              </div>

              <div id="pw-error" class="form-error is-hidden"></div>

              <label class="check">
                <input type="checkbox" id="pw-remember" checked>
                <span>记住登录（30 天内免登录）</span>
              </label>

              <button type="submit" class="btn btn--primary btn--block" id="pw-submit">登录</button>
            </form>

            <div class="login-foot">Powered by OpenTYG</div>
          </div>
        </div>
      </div>`;

    /* ------------------------------------------------------ 元素引用 */
    const el = (id) => root.querySelector(id);
    const smsForm = el('#sms-form');
    const pwForm = el('#pw-form');
    const mobileInput = el('#sms-mobile');
    const codeInput = el('#sms-code');
    const smsSendBtn = el('#sms-send');
    const smsSubmitBtn = el('#sms-submit');
    const smsError = el('#sms-error');
    const pwSubmitBtn = el('#pw-submit');
    const pwError = el('#pw-error');
    const pwDeviceField = el('#pw-device-field');
    const pwDeviceCode = el('#pw-device-code');

    /* -------------------------------------------------------- 错误提示 */
    async function showRateLimit(error) {
      if (!['SMS_RATE_LIMITED', 'PASSWORD_RATE_LIMITED'].includes(error?.code)) return false;
      closeCaptchaDialog();
      await confirmDialog({ title: '请求受限', message: error.message, cancelText: '', okText: '知道了' });
      return true;
    }
    function showError(node, message, kind = 'error') {
      if (!message) {
        node.classList.add('is-hidden');
        node.textContent = '';
        return;
      }
      node.classList.remove('is-hidden');
      node.classList.toggle('form-error--warn', kind === 'warn');
      node.textContent = message;
    }

    function setBusy(btn, busy, busyText) {
      if (!btn) return;
      if (busy) {
        if (!btn.dataset.text) btn.dataset.text = btn.textContent;
        btn.disabled = true;
        btn.textContent = busyText || '处理中…';
      } else {
        btn.disabled = false;
        if (btn.dataset.text) { btn.textContent = btn.dataset.text; delete btn.dataset.text; }
      }
    }

    /* ------------------------------------------------------ 页签切换 */
    function switchTab(next) {
      tab = next;
      root.querySelectorAll('.tab-item').forEach((b) => {
        b.classList.toggle('is-active', b.dataset.tab === next);
      });
      smsForm.classList.toggle('is-hidden', next !== 'sms');
      pwForm.classList.toggle('is-hidden', next !== 'password');
    }
    root.querySelectorAll('.tab-item').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    /* ------------------------------------------------------ 图形验证码弹窗
     * 官方接口要求在发短信前先过图形码校验，但没必要把它常驻在登录表单里。
     * 这里改成：点「获取验证码」→ 弹窗内展示图形码 + 输入框 → 确认后发短信。
     * 想换一张时直接点弹窗里的图片即可。
     */
    let dialog = null;

    function closeCaptchaDialog() {
      if (!dialog) return;
      dialog.wrap.remove();
      document.removeEventListener('keydown', dialog.onKey);
      dialog = null;
    }

    function openCaptchaDialog() {
      closeCaptchaDialog();
      const modalRoot = document.getElementById('modal-root');
      if (!modalRoot) return null;

      const wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = `
        <div class="modal__backdrop"></div>
        <div class="captcha-card" role="dialog" aria-modal="true" aria-labelledby="captcha-title">
          <div class="captcha-card__title" id="captcha-title">输入图形验证码</div>
          <div class="captcha-card__sub">用于发送短信验证码，点击图片可换一张</div>
          <button type="button" class="captcha-card__imgbox" id="cc-imgbox" aria-label="点击更换图形验证码">
            <span class="spinner"></span>
          </button>
          <input class="input" id="cc-input" type="text" inputmode="numeric" maxlength="8"
                 placeholder="请输入图片中的字符" autocomplete="off" spellcheck="false">
          <div class="captcha-card__error is-hidden" id="cc-error"></div>
          <div class="captcha-card__actions">
            <button type="button" class="btn btn--ghost" id="cc-cancel">取消</button>
            <button type="button" class="btn btn--primary" id="cc-ok">发送短信</button>
          </div>
        </div>`;

      modalRoot.appendChild(wrap);
      dialog = {
        wrap,
        input: wrap.querySelector('#cc-input'),
        imgBox: wrap.querySelector('#cc-imgbox'),
        error: wrap.querySelector('#cc-error'),
        okBtn: wrap.querySelector('#cc-ok'),
        onKey: null,
      };

      const setDialogError = (message) => {
        if (!dialog) return;
        if (!message) { dialog.error.classList.add('is-hidden'); dialog.error.textContent = ''; return; }
        dialog.error.classList.remove('is-hidden');
        dialog.error.textContent = message;
      };

      /** 拉取（或刷新）图形码并渲染到弹窗图片位 */
      const loadImage = async (refresh) => {
        if (!dialog) return false;
        dialog.imgBox.innerHTML = '<span class="spinner"></span>';
        dialog.imgBox.classList.add('is-loading');
        try {
          const data = await api.requestCaptcha(captcha.mobile, refresh);
          captcha = { challengeId: data.challengeId, imageUrl: data.imageUrl, mobile: captcha.mobile };
          dialog.imgBox.innerHTML = '';
          const img = document.createElement('img');
          img.alt = '图形验证码';
          img.src = `${captcha.imageUrl}${captcha.imageUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
          img.addEventListener('error', () => {
            dialog.imgBox.innerHTML = '<span class="captcha-card__fail">加载失败，点击重试</span>';
          });
          dialog.imgBox.appendChild(img);
          return true;
        } catch (err) {
          if (await showRateLimit(err)) return false;
          if (dialog) dialog.imgBox.innerHTML = '<span class="captcha-card__fail">加载失败，点击重试</span>';
          setDialogError(err.message || '图形验证码获取失败，请重试');
          return false;
        } finally {
          dialog?.imgBox.classList.remove('is-loading');
        }
      };

      dialog.loadImage = loadImage;
      dialog.setDialogError = setDialogError;

      wrap.addEventListener('click', guard(async (e) => {
        if (e.target.closest('#cc-cancel') || e.target.closest('.modal__backdrop')) { closeCaptchaDialog(); return; }
        if (e.target.closest('#cc-imgbox')) { await loadImage(true); return; }   // 点图片 = 换一张
        if (e.target.closest('#cc-ok')) { await submitCaptcha(); }
      }));

      wrap.addEventListener('keydown', guard(async (e) => {
        if (e.target.id !== 'cc-input') return;
        if (e.key === 'Enter') { e.preventDefault(); await submitCaptcha(); }
        else if (e.key === 'Escape') { closeCaptchaDialog(); }
      }));

      dialog.onKey = (e) => { if (e.key === 'Escape') closeCaptchaDialog(); };
      document.addEventListener('keydown', dialog.onKey);

      return dialog;
    }

    /* -------------------------------------------------------- 发送短信 */
    function startCountdown(seconds) {
      smsCountdown = Math.max(0, Number(seconds) || 0) || 60;
      if (countdownTimer) clearInterval(countdownTimer);
      const tick = () => {
        if (smsCountdown <= 0) {
          clearInterval(countdownTimer);
          countdownTimer = null;
          smsSendBtn.disabled = false;
          smsSendBtn.textContent = '获取验证码';
          return;
        }
        smsSendBtn.disabled = true;
        smsSendBtn.textContent = `${smsCountdown}s`;
        smsCountdown -= 1;
      };
      tick();
      countdownTimer = setInterval(tick, 1000);
    }

    /** 点了「获取验证码」：先校验手机号，再弹窗收图形码 */
    async function requestSmsCode() {
      if (smsSendBtn.disabled) return;
      const mobile = mobileInput.value.trim();
      if (!MOBILE_RE.test(mobile)) {
        showError(smsError, '请输入 11 位手机号');
        mobileInput.focus();
        return;
      }
      showError(smsError, '');

      // 手机号变了就丢弃旧挑战，重新走一遍图形码
      if (captcha && captcha.mobile !== mobile) captcha = null;
      if (!captcha) {
        try {
          const data = await api.requestCaptcha(mobile);
          captcha = { challengeId: data.challengeId, imageUrl: data.imageUrl, mobile };
        } catch (err) {
          showError(smsError, err.message || '图形验证码获取失败，请重试');
          await showRateLimit(err);
          return;
        }
      }

      const d = openCaptchaDialog();
      if (!d) return;
      await d.loadImage(false);
      d.input.focus();
    }

    async function submitCaptcha() {
      if (!dialog || !captcha) return;
      const picRandom = (dialog.input.value || '').trim();
      if (!picRandom) {
        dialog.setDialogError('请输入图片中的字符');
        dialog.input.focus();
        return;
      }
      dialog.setDialogError('');
      setBusy(dialog.okBtn, true, '发送中…');
      try {
        const data = await api.sendSms(captcha.challengeId, picRandom);
        closeCaptchaDialog();
        startCountdown(data && data.retryAfterSeconds);
        showError(smsError, '短信验证码已发送，请注意查收', 'warn');
        codeInput.focus();
      } catch (err) {
        setBusy(dialog.okBtn, false);
        if (await showRateLimit(err)) return;
        const code = err && err.code;
        if (code === 'SMS_REJECTED') {
          dialog.setDialogError(`${err.message || '图形验证码不正确'}，已换一张`);
          dialog.input.value = '';
          await dialog.loadImage(true);
          dialog.input.focus();
        } else if (code === 'CAPTCHA_EXPIRED') {
          dialog.setDialogError('图形验证码已过期，已重新获取');
          await dialog.loadImage(false);
          dialog.input.focus();
        } else {
          dialog.setDialogError(err.message || '短信验证码发送失败，请重试');
        }
      }
    }

    smsSendBtn.addEventListener('click', guard(requestSmsCode));

    /* ------------------------------------------------------------ 登录 */
    function afterLogin(data) {
      store.applySession(data);
      toast('登录成功', 'ok');
      ctx.navigate('/home', { replace: true });
    }

    async function submitSms(event) {
      event.preventDefault();
      const mobile = mobileInput.value.trim();
      const smsCode = codeInput.value.trim();
      if (!MOBILE_RE.test(mobile)) { showError(smsError, '请输入 11 位手机号'); mobileInput.focus(); return; }
      if (!smsCode) { showError(smsError, '请输入短信验证码'); codeInput.focus(); return; }

      showError(smsError, '');
      setBusy(smsSubmitBtn, true, '登录中…');
      try {
        const data = await api.loginSms({
          mobile,
          smsCode,
          remember: el('#sms-remember').checked,
        });
        afterLogin(data);
      } catch (err) {
        showError(smsError, err.message || '登录失败，请重试');
        setBusy(smsSubmitBtn, false);
        await showRateLimit(err);
      }
    }

    async function submitPassword(event) {
      event.preventDefault();
      const account = el('#pw-account').value.trim();
      const password = el('#pw-password').value;
      const changeDeviceSmsCode = pwDeviceCode.value.trim();

      if (!account) { showError(pwError, '请输入账号'); el('#pw-account').focus(); return; }
      if (!password) { showError(pwError, '请输入密码'); el('#pw-password').focus(); return; }
      if (!pwDeviceField.classList.contains('is-hidden') && !changeDeviceSmsCode) {
        showError(pwError, '请输入换设备短信验证码');
        pwDeviceCode.focus();
        return;
      }

      showError(pwError, '');
      setBusy(pwSubmitBtn, true, '登录中…');
      try {
        const data = await api.loginPassword({
          account,
          password,
          changeDeviceSmsCode,
          remember: el('#pw-remember').checked,
        });
        afterLogin(data);
      } catch (err) {
        setBusy(pwSubmitBtn, false);
        if (await showRateLimit(err)) return;
        if (err && err.code === 'DEVICE_VERIFICATION_REQUIRED') {
          pwDeviceField.classList.remove('is-hidden');
          showError(pwError, err.message || '该账号在新设备登录，请填写短信验证码后重试', 'warn');
          pwDeviceCode.focus();
        } else {
          showError(pwError, err.message || '登录失败，请重试');
        }
        setBusy(pwSubmitBtn, false);
      }
    }

    smsForm.addEventListener('submit', guard(submitSms));
    pwForm.addEventListener('submit', guard(submitPassword));

    /* ---------------------------------------------------------- 清理 */
    return function destroy() {
      if (countdownTimer) clearInterval(countdownTimer);
      closeCaptchaDialog();
    };
  },
};
